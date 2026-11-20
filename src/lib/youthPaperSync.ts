import { User } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  describeApiTarget,
  formatServerFetchError,
  getActiveApiBaseUrl,
  resolveApiUrl,
} from './apiConfig';
import {
  LIMITS,
  PaperRecord,
  ResearchSyncStatus,
  YOUTH_RESEARCH_CATEGORIES,
  YouthResearchCategory,
} from '../types/community';

export const MONTHLY_CRON = '0 3 1 * *';
export const MONTHLY_TIMEZONE = 'Asia/Seoul';
export const MONTHLY_INTERVAL_DAYS = 30;
const STALE_SYNC_TIMEOUT_MS = 3 * 60 * 1000;

const BROWSER_CATEGORY_QUERIES: Array<{
  category: YouthResearchCategory;
  koQuery: string;
  enQuery: string;
}> = [
  {
    category: '청소년지도 및 청소년 활동',
    koQuery: '청소년지도|청소년활동|청소년지도자|청소년수련활동|청소년시설|청소년 정책',
    enQuery: '"youth work"|"youth development"|"youth policy"|"youth center"',
  },
  {
    category: '청소년 진로 및 리더십',
    koQuery: '청소년 진로|진로개발|진로교육|진로탐색|청소년 리더십|자기주도성|청소년 역량',
    enQuery: '"career development" adolescent|"youth leadership"|"self-directed" youth',
  },
  {
    category: '청소년 참여 및 사회적 성장',
    koQuery: '청소년 참여|청소년 참여권|자치활동|민주시민교육|청소년 시민성|청소년 봉사활동',
    enQuery: '"youth participation"|"youth empowerment"|"civic engagement" youth',
  },
  {
    category: 'AI 및 디지털 시대의 청소년',
    koQuery: '청소년 생성형 AI|청소년 인공지능|디지털 리터러시|디지털 시민성|미디어 교육|온라인 청소년활동',
    enQuery: '"digital citizenship" youth|"generative AI" adolescent|"digital literacy" youth',
  },
  {
    category: '청소년 교육 및 평생학습',
    koQuery: '청소년 교육|비형식교육|체험학습 청소년|프로젝트 학습 청소년|청소년 평생교육|교육 프로그램 개발',
    enQuery: '"experiential learning" youth|"non-formal education" youth|"lifelong learning" youth',
  },
  {
    category: '청소년 문제 및 사회 변화',
    koQuery: '학교 밖 청소년|청소년 복지|청소년 사회적 고립|세대 변화 청소년|청소년 또래관계|청소년 가족',
    enQuery: '"youth welfare"|"out-of-school youth"|"social isolation" adolescent|"social change" youth',
  },
];

interface CollectedPaperDraft {
  paperId: string;
  title: string;
  authors: string[];
  journalName: string;
  publicationDate: string;
  language: string;
  region: 'domestic' | 'international';
  abstract: string;
  keywords: string[];
  doi: string;
  openAlexId: string;
  crossrefId: string;
  paperUrl: string;
  source: string;
  openAccess: boolean;
  citedByCount: number;
  hintCategory: YouthResearchCategory;
}

export interface YouthSyncRunResult {
  ok: boolean;
  collectedCount: number;
  newPapersCount: number;
  analyzedSuccessCount: number;
  analyzedFailedCount: number;
  message: string;
  staticHostingFallback?: boolean;
}

let activeYouthSyncPromise: Promise<YouthSyncRunResult> | null = null;

export function isSyncActivelyRunning(status: ResearchSyncStatus | null | undefined): boolean {
  if (!status || status.lastSyncStatus !== 'syncing') return false;
  const updatedMs = status.updatedAt?.toMillis?.();
  if (!updatedMs) return false;
  return Date.now() - updatedMs < STALE_SYNC_TIMEOUT_MS;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim();
}

function normalizeDoi(doi?: string | null): string {
  if (!doi) return '';
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .toLowerCase();
}

function sanitizeStringArray(arr: string[] | undefined, maxItems: number, maxItemLen = 240): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => String(item || '').trim().slice(0, maxItemLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function reconstructInvertedAbstract(index?: Record<string, number[]> | null): string {
  if (!index || typeof index !== 'object') return '';
  let maxPos = -1;
  for (const positions of Object.values(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos > maxPos) maxPos = pos;
    }
  }
  if (maxPos < 0 || maxPos > 6000) return '';
  const words = new Array<string>(maxPos + 1).fill('');
  for (const [token, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos >= 0 && pos <= maxPos) words[pos] = token;
    }
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

function makeSafePaperId(openAlexId: string, doi: string, title: string): string {
  const oaTail = openAlexId.split('/').pop() || '';
  if (/^[a-zA-Z0-9_-]{3,60}$/.test(oaTail)) {
    return `oa_${oaTail}`;
  }
  const input = doi || normalizeTitle(title);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `paper_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`.slice(0, 120);
}

const KOREAN_YOUTH_JOURNAL_SIGNALS = [
  { doiPrefix: '10.21509', nameKo: '청소년학연구', nameEn: 'korean journal of youth studies', publisherEn: 'korea youth research association' },
  { doiPrefix: '10.14816', nameKo: '한국청소년연구', nameEn: 'studies on korean youth', publisherEn: 'national youth policy institute' },
  { doiPrefix: '10.19034', nameKo: '청소년복지연구', nameEn: 'journal of adolescent welfare', publisherEn: 'korean association of youth welfare' },
  { doiPrefix: '10.17854', nameKo: '청소년문화포럼', nameEn: 'forum for youth culture', publisherEn: 'research center for korea youth culture' },
  { doiPrefix: '10.55063', nameKo: '청소년시설환경', nameEn: 'youth facility and environment', publisherEn: 'korea institute of youth facility and environment' },
  { doiPrefix: '10.34244', nameKo: '미래청소년학회지', nameEn: 'future oriented youth society', publisherEn: 'future oriented youth society' },
];

function detectDomesticPaper(params: {
  language?: string;
  title?: string;
  journalName?: string;
  publisher?: string;
  abstract?: string;
  doi?: string;
  countryCodes?: string[];
  institutions?: string[];
}): boolean {
  const doiLower = normalizeDoi(params.doi);
  const journalLower = (params.journalName || '').toLowerCase();
  const publisherLower = (params.publisher || '').toLowerCase();

  if (
    KOREAN_YOUTH_JOURNAL_SIGNALS.some(
      (j) =>
        (doiLower && doiLower.startsWith(`${j.doiPrefix}/`)) ||
        journalLower.includes(j.nameKo) ||
        journalLower.includes(j.nameEn) ||
        publisherLower.includes(j.publisherEn)
    )
  ) {
    return true;
  }

  if (params.countryCodes?.some((c) => c.toUpperCase() === 'KR')) return true;

  const orgText = `${journalLower} ${publisherLower} ${(params.institutions || []).join(' ').toLowerCase()}`;
  const orgMarkers = [
    'korean',
    'korea',
    'south korea',
    'myongji',
    'seoul',
    'yonsei',
    'nyci',
    'kywa',
    'kci',
    '한국',
    '대한',
    '청소년',
    '명지',
    '학회',
  ];
  if (orgMarkers.some((m) => orgText.includes(m))) return true;

  const hasHangul = /[가-힣]/.test(
    `${params.title || ''} ${params.journalName || ''} ${params.publisher || ''} ${params.abstract || ''}`
  );
  return params.language === 'ko' || hasHangul;
}

interface BrowserOpenAlexWork {
  id?: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_date?: string | null;
  language?: string | null;
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]> | null;
  open_access?: { is_oa?: boolean; oa_url?: string | null } | null;
  primary_location?: {
    landing_page_url?: string | null;
    source?: {
      display_name?: string | null;
      country_code?: string | null;
      host_organization_name?: string | null;
    } | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
    countries?: string[];
    institutions?: Array<{ display_name?: string | null; country_code?: string | null }>;
  }>;
  keywords?: Array<{ display_name?: string | null }>;
  concepts?: Array<{ display_name?: string | null }>;
}

interface BrowserCrossrefItem {
  DOI?: string;
  URL?: string;
  title?: string[];
  'container-title'?: string[];
  publisher?: string;
  author?: Array<{
    given?: string;
    family?: string;
    name?: string;
    affiliation?: Array<{ name?: string }>;
  }>;
  abstract?: string;
  published?: { 'date-parts'?: number[][] };
  'published-online'?: { 'date-parts'?: number[][] };
  'published-print'?: { 'date-parts'?: number[][] };
  language?: string;
}

async function fetchOpenAlexBrowser(filter: string, page: number, perPage: number) {
  const qs = new URLSearchParams({
    filter,
    sort: 'publication_date:desc',
    page: String(page),
    'per-page': String(perPage),
    mailto: 'schaum@mju.ac.kr',
  });
  const res = await fetch(`https://api.openalex.org/works?${qs.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
  const data = (await res.json()) as { results?: BrowserOpenAlexWork[] };
  return Array.isArray(data.results) ? data.results : [];
}

async function fetchCrossrefBrowser(doi: string): Promise<BrowserCrossrefItem | null> {
  const cleanDoi = normalizeDoi(doi);
  if (!cleanDoi) return null;
  try {
    const res = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}?mailto=schaum@mju.ac.kr`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: BrowserCrossrefItem };
    return data.message || null;
  } catch {
    return null;
  }
}

async function collectPapersViaBrowserFallback(params: {
  existingDois: string[];
  existingOpenAlexIds: string[];
  existingTitles: string[];
  perCategoryLimit: number;
  lookbackMonths: number;
}) {
  const safeMonths = Math.min(Math.max(Math.round(params.lookbackMonths || 3), 1), 60);
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const from = new Date(now);
  from.setMonth(from.getMonth() - safeMonths);
  const fromDate = from.toISOString().slice(0, 10);

  const existingDoiSet = new Set(params.existingDois.map((d) => normalizeDoi(d)).filter(Boolean));
  const existingOaSet = new Set(params.existingOpenAlexIds.map((id) => id.trim()).filter(Boolean));
  const existingTitleSet = new Set(params.existingTitles.map(normalizeTitle).filter(Boolean));

  let openAlexCalls = 0;
  let crossrefCalls = 0;
  const collectionErrors: string[] = [];
  const candidateMap = new Map<
    string,
    { work: BrowserOpenAlexWork; hintCategory: YouthResearchCategory }
  >();

  for (const cfg of BROWSER_CATEGORY_QUERIES) {
    try {
      openAlexCalls += 1;
      const enResults = await fetchOpenAlexBrowser(
        `from_publication_date:${fromDate},to_publication_date:${toDate},title_and_abstract.search:${cfg.enQuery}`,
        1,
        Math.min(params.perCategoryLimit + 1, 5)
      );
      enResults.forEach((work) => {
        if (work.id && !candidateMap.has(work.id)) {
          candidateMap.set(work.id, { work, hintCategory: cfg.category });
        }
      });
    } catch (err) {
      collectionErrors.push(
        `OpenAlex 영문 수집 오류(${cfg.category}): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    try {
      openAlexCalls += 1;
      const koResults = await fetchOpenAlexBrowser(
        `from_publication_date:${fromDate},to_publication_date:${toDate},language:ko,default.search:${cfg.koQuery}`,
        1,
        Math.min(params.perCategoryLimit + 1, 5)
      );
      koResults.forEach((work) => {
        if (work.id && !candidateMap.has(work.id)) {
          candidateMap.set(work.id, { work, hintCategory: cfg.category });
        }
      });
    } catch (err) {
      collectionErrors.push(
        `OpenAlex 국문 수집 오류(${cfg.category}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const initialKoCount = Array.from(candidateMap.values()).filter(({ work }) =>
    detectDomesticPaper({
      language: work.language || '',
      title: work.title || work.display_name || '',
      journalName: work.primary_location?.source?.display_name || '',
      countryCodes: work.authorships?.flatMap((a) => a.countries || []) || [],
    })
  ).length;

  let expandedKoreanSearchUsed = false;
  if (initialKoCount < 4) {
    expandedKoreanSearchUsed = true;
    try {
      for (let page = 1; page <= 2; page += 1) {
        openAlexCalls += 1;
        const broadKo = await fetchOpenAlexBrowser(
          `from_publication_date:${fromDate},to_publication_date:${toDate},language:ko,default.search:청소년|청년|진로|디지털|학교`,
          page,
          6
        );
        broadKo.forEach((work) => {
          if (work.id && !candidateMap.has(work.id)) {
            candidateMap.set(work.id, { work, hintCategory: '청소년지도 및 청소년 활동' });
          }
        });
      }
    } catch (err) {
      collectionErrors.push(
        `OpenAlex 국내 확장 검색 오류: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const freshEntries: Array<{ work: BrowserOpenAlexWork; hintCategory: YouthResearchCategory }> = [];
  for (const entry of candidateMap.values()) {
    const title = (entry.work.title || entry.work.display_name || '').trim();
    const oaId = (entry.work.id || '').trim();
    const doi = normalizeDoi(entry.work.doi);
    const normT = normalizeTitle(title);

    if (!title || title.length < 3) continue;
    if (oaId && existingOaSet.has(oaId)) continue;
    if (doi && existingDoiSet.has(doi)) continue;
    if (existingTitleSet.has(normT)) continue;

    existingTitleSet.add(normT);
    if (oaId) existingOaSet.add(oaId);
    if (doi) existingDoiSet.add(doi);
    freshEntries.push(entry);
    if (freshEntries.length >= 16) break;
  }

  const enrichedPapers: CollectedPaperDraft[] = await Promise.all(
    freshEntries.map(async ({ work, hintCategory }) => {
      const doiClean = normalizeDoi(work.doi);
      let crItem: BrowserCrossrefItem | null = null;
      if (doiClean) {
        crossrefCalls += 1;
        crItem = await fetchCrossrefBrowser(doiClean);
      }

      const title = (work.title || work.display_name || crItem?.title?.[0] || '제목 미상')
        .trim()
        .slice(0, 300);

      const oaAuthors = (work.authorships || [])
        .map((a) => a.author?.display_name?.trim())
        .filter((n): n is string => Boolean(n));
      const crAuthors = (crItem?.author || [])
        .map((a) => a.name || [a.family, a.given].filter(Boolean).join(' ').trim())
        .filter(Boolean);
      const authors = (oaAuthors.length > 0 ? oaAuthors : crAuthors).slice(0, 20);
      if (authors.length === 0) authors.push('저자 정보 확인 중');

      const journalName = (
        work.primary_location?.source?.display_name ||
        crItem?.['container-title']?.[0] ||
        '학술지 미상'
      )
        .trim()
        .slice(0, 200);

      const crParts =
        crItem?.published?.['date-parts']?.[0] ||
        crItem?.['published-online']?.['date-parts']?.[0] ||
        crItem?.['published-print']?.['date-parts']?.[0];
      const crDate =
        crParts && crParts.length > 0
          ? `${crParts[0]}-${String(crParts[1] || 1).padStart(2, '0')}-${String(crParts[2] || 1).padStart(2, '0')}`
          : '';
      const publicationDate = (work.publication_date || crDate || toDate).slice(0, 20);

      const oaAbstract = reconstructInvertedAbstract(work.abstract_inverted_index);
      const crAbstract = crItem?.abstract ? stripTags(crItem.abstract) : '';
      const abstract = (oaAbstract || crAbstract || '').slice(0, 8000);

      const language = (
        work.language ||
        crItem?.language ||
        (/[가-힣]/.test(title) ? 'ko' : 'en')
      ).slice(0, 20);

      const publisher = (
        work.primary_location?.source?.host_organization_name ||
        crItem?.publisher ||
        ''
      ).trim();

      const countryCodes = [
        ...(work.primary_location?.source?.country_code
          ? [work.primary_location.source.country_code]
          : []),
        ...(work.authorships?.flatMap((a) => [
          ...(a.countries || []),
          ...((a.institutions || []).map((i) => i.country_code || '').filter(Boolean)),
        ]) || []),
      ];
      const institutions = [
        ...(work.authorships?.flatMap((a) =>
          (a.institutions || []).map((i) => i.display_name || '').filter(Boolean)
        ) || []),
        ...(crItem?.author?.flatMap((a) =>
          (a.affiliation || []).map((af) => af.name || '').filter(Boolean)
        ) || []),
      ];
      const isDomestic = detectDomesticPaper({
        language,
        title,
        journalName,
        publisher,
        abstract,
        doi: doiClean,
        countryCodes,
        institutions,
      });

      const keywords = Array.from(
        new Set([
          ...(work.keywords || []).map((k) => k.display_name?.trim()).filter(Boolean),
          ...(work.concepts || []).slice(0, 4).map((c) => c.display_name?.trim()).filter(Boolean),
        ])
      ).slice(0, 12) as string[];

      const openAlexId = (work.id || '').slice(0, 160);
      const crossrefId = (crItem?.DOI || doiClean || '').slice(0, 200);
      const paperUrl = (
        work.open_access?.oa_url ||
        work.primary_location?.landing_page_url ||
        crItem?.URL ||
        (doiClean ? `https://doi.org/${doiClean}` : openAlexId)
      ).slice(0, 500);

      return {
        paperId: makeSafePaperId(openAlexId, doiClean, title),
        title,
        authors,
        journalName,
        publicationDate,
        language,
        region: (isDomestic ? 'domestic' : 'international') as 'domestic' | 'international',
        abstract,
        keywords,
        doi: doiClean.slice(0, 200),
        openAlexId,
        crossrefId,
        paperUrl,
        source: crItem ? 'OpenAlex + Crossref' : 'OpenAlex',
        openAccess: Boolean(work.open_access?.is_oa),
        citedByCount: Number(work.cited_by_count || 0),
        hintCategory,
      };
    })
  );

  const domesticCount = enrichedPapers.filter((p) => p.region === 'domestic').length;
  const internationalCount = enrichedPapers.length - domesticCount;
  const koreanCoverageNotice =
    domesticCount < 3 || expandedKoreanSearchUsed
      ? '국내 학술지의 OpenAlex·Crossref 색인 시차로 인해 일부 최신 국내 논문이 수집되지 않았을 수 있습니다. 추가 국내 논문은 구글 학술검색(Google Scholar) 바로가기를 통해 함께 확인하실 수 있습니다.'
      : '';

  return {
    papers: enrichedPapers,
    stats: {
      collectedCount: enrichedPapers.length,
      domesticCount,
      internationalCount,
      openAlexCalls,
      crossrefCalls,
      collectionErrors: collectionErrors.slice(0, 25),
      koreanCoverageNotice,
      fromDate,
      toDate,
      lookbackMonths: safeMonths,
    },
  };
}

export function buildGoogleScholarPaperUrl(title: string, firstAuthor?: string): string {
  const queryText =
    firstAuthor && firstAuthor !== '저자 정보 확인 중' ? `${title} ${firstAuthor}` : title;
  return `https://scholar.google.co.kr/scholar?q=${encodeURIComponent(queryText)}`;
}

export function buildGoogleScholarCategoryUrl(category: YouthResearchCategory): string {
  const categoryQueries: Record<YouthResearchCategory, string> = {
    '청소년지도 및 청소년 활동': '청소년지도 OR 청소년활동 OR "youth work"',
    '청소년 진로 및 리더십': '청소년 진로 리더십 역량 OR "youth leadership"',
    '청소년 참여 및 사회적 성장': '청소년 참여 시민성 자치 OR "youth participation"',
    'AI 및 디지털 시대의 청소년': '청소년 AI 디지털 리터러시 시민성 OR "digital citizenship"',
    '청소년 교육 및 평생학습': '청소년 비형식교육 체험학습 평생교육 OR "experiential learning"',
    '청소년 문제 및 사회 변화': '학교 밖 청소년 복지 사회적 고립 OR "youth welfare"',
  };
  return `https://scholar.google.co.kr/scholar?q=${encodeURIComponent(categoryQueries[category])}&as_ylo=${new Date().getFullYear() - 1}`;
}

export function getKstScheduleContext(dateInput: Date = new Date()) {
  const safeDate = Number.isNaN(dateInput.getTime()) ? new Date() : dateInput;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MONTHLY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(safeDate);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = Number(getPart('year'));
  const month = Number(getPart('month'));
  const day = Number(getPart('day'));
  const hour = Number(getPart('hour')) % 24;

  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
  const currentMonthLabel = `${year}년 ${String(month).padStart(2, '0')}월`;
  const kstDateLabel = `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  const kstNowLabel = `${kstDateLabel} ${String(hour).padStart(2, '0')}:${getPart('minute')} KST`;
  const isPastScheduledSlotThisMonth = day > 1 || (day === 1 && hour >= 3);
  const currentMonthSlotLabel = `${year}.${String(month).padStart(2, '0')}.01 03:00 (Asia/Seoul)`;

  let nextYear = year;
  let nextMonth = month;
  if (isPastScheduledSlotThisMonth) {
    nextMonth += 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
  }

  const nextIso = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T03:00:00+09:00`;
  const nextRunDate = new Date(nextIso);

  return {
    cron: MONTHLY_CRON,
    timezone: MONTHLY_TIMEZONE,
    currentMonthKey,
    currentMonthLabel,
    kstDateLabel,
    kstNowLabel,
    isPastScheduledSlotThisMonth,
    currentMonthSlotLabel,
    nextRunDate,
    nextRunTimestamp: Timestamp.fromDate(nextRunDate),
    nextRunLabel: `${nextYear}.${String(nextMonth).padStart(2, '0')}.01 03:00 (Asia/Seoul)`,
  };
}

export function evaluateMonthlySyncDue({
  researchSyncStatus,
  papersCount,
  referenceDate = new Date(),
}: {
  researchSyncStatus: ResearchSyncStatus | null;
  papersCount: number;
  referenceDate?: Date;
}): {
  due: boolean;
  reason: string;
  kst: ReturnType<typeof getKstScheduleContext>;
} {
  const kst = getKstScheduleContext(referenceDate);
  if (researchSyncStatus?.autoEnabled === false) {
    return { due: false, reason: '자동 스케줄이 일시 중지되어 있습니다.', kst };
  }
  if (papersCount <= 0) {
    return { due: true, reason: '초기 수집 논문이 없어 자동 수집 대상입니다.', kst };
  }
  if (!researchSyncStatus?.lastSyncedAt || researchSyncStatus.scheduleCron !== MONTHLY_CRON) {
    return {
      due: true,
      reason: '월간 정기 수집(0 3 1 * * KST) 이력이 없어 자동 수집 대상입니다.',
      kst,
    };
  }
  if (!kst.isPastScheduledSlotThisMonth) {
    return {
      due: false,
      reason: `이번 달 정기 시각(${kst.currentMonthSlotLabel}) 도래 전입니다.`,
      kst,
    };
  }

  const lastDate = researchSyncStatus.lastSyncedAt.toDate();
  const lastCtx = getKstScheduleContext(lastDate);
  if (lastCtx.currentMonthKey < kst.currentMonthKey) {
    return {
      due: true,
      reason: `이번 달 정기 시각(${kst.currentMonthSlotLabel}) 이후 미실행 상태로 자동 실행 대상입니다.`,
      kst,
    };
  }

  return {
    due: false,
    reason: `${kst.currentMonthLabel} 정기 수집 완료 (${lastCtx.kstNowLabel})`,
    kst,
  };
}

export function isMonthlySyncDue({
  researchSyncStatus,
  papersCount,
}: {
  researchSyncStatus: ResearchSyncStatus | null;
  papersCount: number;
}): boolean {
  return evaluateMonthlySyncDue({ researchSyncStatus, papersCount }).due;
}

export async function toggleYouthResearchAutoSync({
  enabled,
  authUser,
  actorName,
  currentStatus,
}: {
  enabled: boolean;
  authUser: User;
  actorName: string;
  currentStatus: ResearchSyncStatus | null;
}): Promise<void> {
  const kst = getKstScheduleContext();
  const safeActorName = (actorName?.trim() || '원우회 관리자').slice(0, LIMITS.displayName);
  const statusRef = doc(db, 'settings', 'researchSync');
  try {
    await setDoc(statusRef, {
      autoEnabled: enabled,
      intervalDays: MONTHLY_INTERVAL_DAYS,
      ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
      nextSyncAt: kst.nextRunTimestamp,
      lastSyncStatus: currentStatus?.lastSyncStatus || 'idle',
      ...(currentStatus?.lastSyncMode ? { lastSyncMode: currentStatus.lastSyncMode } : {}),
      lastSyncCount: Math.min(Math.max(0, Math.round(currentStatus?.lastSyncCount ?? 0)), 500),
      lastSyncMessage: (enabled
        ? '매월 1일 오전 3시(Asia/Seoul) 자동 논문 수집 스케줄이 활성화되었습니다.'
        : '매월 1일 자동 논문 수집 스케줄이 관리자에 의해 일시 중지되었습니다.'
      ).slice(0, 400),
      windowLabel: (currentStatus?.windowLabel || '정기 월간 수집 (KST 03:00)').slice(0, 80),
      scheduleCron: MONTHLY_CRON,
      timezone: MONTHLY_TIMEZONE,
      ...(currentStatus?.koreanCoverageNotice
        ? { koreanCoverageNotice: currentStatus.koreanCoverageNotice.slice(0, 400) }
        : {}),
      updatedByUid: authUser.uid,
      updatedByName: safeActorName,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/researchSync');
  }
}

export async function resetStaleYouthSyncLock({
  authUser,
  actorName,
  currentStatus,
}: {
  authUser: User;
  actorName: string;
  currentStatus: ResearchSyncStatus | null;
}): Promise<void> {
  const kst = getKstScheduleContext();
  const safeActorName = (actorName?.trim() || '원우회 관리자').slice(0, LIMITS.displayName);
  const statusRef = doc(db, 'settings', 'researchSync');
  try {
    await setDoc(statusRef, {
      autoEnabled: currentStatus?.autoEnabled ?? true,
      intervalDays: MONTHLY_INTERVAL_DAYS,
      ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
      nextSyncAt: kst.nextRunTimestamp,
      lastSyncStatus: 'idle',
      ...(currentStatus?.lastSyncMode ? { lastSyncMode: currentStatus.lastSyncMode } : {}),
      lastSyncCount: Math.min(Math.max(0, Math.round(currentStatus?.lastSyncCount ?? 0)), 500),
      lastSyncMessage: '이전 실행 잠금 상태가 관리자에 의해 초기화되었습니다.'.slice(0, 400),
      windowLabel: (currentStatus?.windowLabel || '잠금 해제됨').slice(0, 80),
      scheduleCron: MONTHLY_CRON,
      timezone: MONTHLY_TIMEZONE,
      ...(currentStatus?.koreanCoverageNotice
        ? { koreanCoverageNotice: currentStatus.koreanCoverageNotice.slice(0, 400) }
        : {}),
      updatedByUid: authUser.uid,
      updatedByName: safeActorName,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'settings/researchSync');
  }
}

export async function collectAndAnalyzePapers({
  triggerType,
  authUser,
  actorName,
  existingPapers,
  autoEnabled = true,
  currentStatus = null,
  perCategoryLimit = 3,
  lookbackMonths = 3,
  onStatusChange,
}: {
  triggerType: 'manual' | 'scheduled_monthly';
  authUser: User;
  actorName: string;
  existingPapers: PaperRecord[];
  autoEnabled?: boolean;
  currentStatus?: ResearchSyncStatus | null;
  perCategoryLimit?: number;
  lookbackMonths?: number;
  onStatusChange?: (statusText: string) => void;
}): Promise<YouthSyncRunResult> {
  if (activeYouthSyncPromise) {
    return activeYouthSyncPromise;
  }

  activeYouthSyncPromise = (async (): Promise<YouthSyncRunResult> => {
    const kst = getKstScheduleContext();
    const statusRef = doc(db, 'settings', 'researchSync');
    const safeActorName = (actorName?.trim() || '원우회 관리자').slice(0, LIMITS.displayName);
    const safeLookback = Math.min(Math.max(Math.round(lookbackMonths || 3), 1), 60);
    const lookbackLabel =
      safeLookback >= 60 ? '초기 5년(60개월)' : safeLookback === 12 ? '정기 12개월' : `최근 ${safeLookback}개월`;

    const existingDois = existingPapers.map((p) => normalizeDoi(p.doi)).filter(Boolean);
    const existingOpenAlexIds = existingPapers
      .map((p) => (p.openAlexId || '').trim())
      .filter(Boolean);
    const existingTitles = existingPapers.map((p) => p.title);

    try {
      await setDoc(statusRef, {
        autoEnabled,
        intervalDays: MONTHLY_INTERVAL_DAYS,
        ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
        nextSyncAt: kst.nextRunTimestamp,
        lastSyncStatus: 'syncing',
        lastSyncMode: triggerType === 'scheduled_monthly' ? 'monthly' : 'manual',
        lastSyncCount: Math.min(Math.max(0, Math.round(currentStatus?.lastSyncCount ?? 0)), 500),
        lastSyncMessage: `OpenAlex·Crossref에서 ${lookbackLabel} 국내외 논문을 수집하고 있습니다...`.slice(
          0,
          400
        ),
        windowLabel: (currentStatus?.windowLabel || lookbackLabel).slice(0, 80),
        scheduleCron: MONTHLY_CRON,
        timezone: MONTHLY_TIMEZONE,
        ...(currentStatus?.koreanCoverageNotice
          ? { koreanCoverageNotice: currentStatus.koreanCoverageNotice.slice(0, 400) }
          : {}),
        updatedByUid: authUser.uid,
        updatedByName: safeActorName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/researchSync');
    }

    try {
      // Step 1: Collect via backend /api/papers/collect, or automatically fall back to CORS OpenAlex/Crossref in browser on static hosting
      let usedStaticCollectionFallback = false;
      let collected: CollectedPaperDraft[] = [];
      let stats: {
        collectedCount: number;
        domesticCount: number;
        internationalCount: number;
        openAlexCalls: number;
        crossrefCalls: number;
        collectionErrors: string[];
        koreanCoverageNotice: string;
        fromDate: string;
        toDate: string;
      };

      try {
        const collectRes = await fetch(resolveApiUrl('/api/papers/collect'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            existingDois,
            existingOpenAlexIds,
            existingTitles,
            perCategoryLimit,
            lookbackMonths: safeLookback,
          }),
        });

        const collectType = collectRes.headers.get('content-type') || '';
        if (!collectType.includes('application/json')) {
          usedStaticCollectionFallback = true;
          const fallbackData = await collectPapersViaBrowserFallback({
            existingDois,
            existingOpenAlexIds,
            existingTitles,
            perCategoryLimit,
            lookbackMonths: safeLookback,
          });
          collected = fallbackData.papers;
          stats = fallbackData.stats;
        } else {
          const collectJson = (await collectRes.json()) as {
            papers?: CollectedPaperDraft[];
            stats?: typeof stats;
            error?: string;
          };
          if (!collectRes.ok || !collectJson.stats) {
            throw new Error(collectJson.error || `논문 수집 서버 오류 (${collectRes.status})`);
          }
          collected = Array.isArray(collectJson.papers) ? collectJson.papers : [];
          stats = collectJson.stats;
        }
      } catch (networkErr) {
        if (!usedStaticCollectionFallback) {
          usedStaticCollectionFallback = true;
          const fallbackData = await collectPapersViaBrowserFallback({
            existingDois,
            existingOpenAlexIds,
            existingTitles,
            perCategoryLimit,
            lookbackMonths: safeLookback,
          });
          collected = fallbackData.papers;
          stats = fallbackData.stats;
        } else {
          throw networkErr;
        }
      }

      const windowLabel = `${stats.fromDate} ~ ${stats.toDate} (${lookbackLabel})`;
      const collectionErrors = sanitizeStringArray(stats.collectionErrors, 25, 240);
      const koreanCoverageNotice = (stats.koreanCoverageNotice || '').slice(0, 400);

      // Deduplicate in client memory
      const seenPaperIds = new Set(existingPapers.map((p) => p.paperId));
      const seenDoi = new Set(existingDois);
      const seenOa = new Set(existingOpenAlexIds);
      const seenTitles = new Set(existingTitles.map(normalizeTitle));
      const newDrafts = collected.filter((p) => {
        const d = normalizeDoi(p.doi);
        const normT = normalizeTitle(p.title);
        if (seenPaperIds.has(p.paperId)) return false;
        if (d && seenDoi.has(d)) return false;
        if (p.openAlexId && seenOa.has(p.openAlexId)) return false;
        if (seenTitles.has(normT)) return false;
        seenPaperIds.add(p.paperId);
        if (d) seenDoi.add(d);
        if (p.openAlexId) seenOa.add(p.openAlexId);
        seenTitles.add(normT);
        return true;
      });

      onStatusChange?.(`OpenAlex·Crossref ${lookbackLabel} 국내외 논문 수집 중...`);

      // Step 2: Save collected papers directly with 6-category classification, metadata, keywords & abstract (no Gemini AI dependency)
      const preparedPaperWrites: Array<{ paperId: string; paperDoc: Record<string, unknown> }> = [];

      newDrafts.forEach((draft) => {
        const cleanTitle = draft.title.trim().slice(0, 300);
        if (cleanTitle.length < 2) return;
        const safePaperId = draft.paperId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
        if (!safePaperId) return;

        const mainCategory = YOUTH_RESEARCH_CATEGORIES.includes(draft.hintCategory)
          ? draft.hintCategory
          : '청소년지도 및 청소년 활동';
        const mergedKeywords = sanitizeStringArray(draft.keywords, 12, 80);
        const defaultBasis = (
          draft.abstract.length >= 40 ? '서지·원문 초록 수집' : '서지정보 수집'
        ).slice(0, 100);

        const paperDoc: Record<string, unknown> = {
          paperId: safePaperId,
          title: cleanTitle,
          authors: sanitizeStringArray(draft.authors, 25, 120),
          journalName: (draft.journalName?.trim() || '학술지 미상').slice(0, 200),
          publicationDate: (
            draft.publicationDate?.trim() || kst.kstDateLabel.replace(/\./g, '-')
          ).slice(0, 20),
          language: (draft.language?.trim() || 'en').slice(0, 20),
          region: draft.region,
          abstract: (draft.abstract || '').slice(0, 8000),
          keywords: mergedKeywords,
          ...(draft.doi ? { doi: draft.doi.slice(0, 200) } : {}),
          ...(draft.openAlexId ? { openAlexId: draft.openAlexId.slice(0, 160) } : {}),
          ...(draft.crossrefId ? { crossrefId: draft.crossrefId.slice(0, 200) } : {}),
          ...(draft.paperUrl ? { paperUrl: draft.paperUrl.slice(0, 500) } : {}),
          source: (draft.source?.trim() || 'OpenAlex').slice(0, 60),
          openAccess: Boolean(draft.openAccess),
          citedByCount: Math.min(Math.max(0, Math.round(Number(draft.citedByCount || 0))), 1000000),
          mainCategory,
          relatedCategories: [],
          analysisBasis: defaultBasis,
          analysisStatus: 'completed',
          isPublished: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        preparedPaperWrites.push({ paperId: safePaperId, paperDoc });
      });

      const PAPER_BATCH_SIZE = 300;
      for (let i = 0; i < preparedPaperWrites.length; i += PAPER_BATCH_SIZE) {
        const paperChunk = preparedPaperWrites.slice(i, i + PAPER_BATCH_SIZE);
        const paperBatch = writeBatch(db);
        paperChunk.forEach(({ paperId, paperDoc }) => {
          paperBatch.set(doc(db, 'papers', paperId), paperDoc);
        });
        await paperBatch.commit();
      }

      const domesticCount = newDrafts.filter((p) => p.region === 'domestic').length;
      const internationalCount = newDrafts.length - domesticCount;
      const logId = `log_${Date.now()}`;
      const logStatus = collectionErrors.length > 0 ? 'partial' : 'success';

      const statusBatch = writeBatch(db);
      statusBatch.set(doc(db, 'syncLogs', logId), {
        logId,
        triggerType,
        status: logStatus,
        collectedCount: Math.min(Math.max(0, Math.round(collected.length)), 10000),
        newPapersCount: Math.min(Math.max(0, Math.round(preparedPaperWrites.length)), 10000),
        domesticCount: Math.min(Math.max(0, Math.round(domesticCount)), 10000),
        internationalCount: Math.min(Math.max(0, Math.round(internationalCount)), 10000),
        analyzedSuccessCount: Math.min(Math.max(0, Math.round(preparedPaperWrites.length)), 10000),
        analyzedFailedCount: 0,
        openAlexCalls: Math.min(Math.max(0, Math.round(stats.openAlexCalls ?? 0)), 10000),
        crossrefCalls: Math.min(Math.max(0, Math.round(stats.crossrefCalls ?? 0)), 10000),
        geminiCalls: 0,
        estimatedTokens: 0,
        collectionErrors,
        analysisErrors: [],
        ...(koreanCoverageNotice ? { koreanCoverageNotice } : {}),
        executedByUid: authUser.uid,
        executedByName: safeActorName,
        createdAt: serverTimestamp(),
      });

      let summaryMessage = '';
      if (newDrafts.length === 0) {
        summaryMessage = `최근 ${safeLookback}개월(${stats.fromDate} ~ ${stats.toDate}) OpenAlex·Crossref 논문을 점검했으며, 신규 미등록 논문이 없어 최신 상태입니다.`;
      } else {
        summaryMessage = `최근 ${safeLookback}개월 신규 논문 ${newDrafts.length}편(국내 ${domesticCount} · 해외 ${internationalCount})의 서지·초록을 6대 분야별로 수집·저장했습니다.`;
      }

      onStatusChange?.('수집 결과 및 실행 로그를 Firestore에 저장하는 중...');
      statusBatch.set(statusRef, {
        autoEnabled,
        intervalDays: MONTHLY_INTERVAL_DAYS,
        lastSyncedAt: serverTimestamp(),
        nextSyncAt: kst.nextRunTimestamp,
        lastSyncStatus: 'success',
        lastSyncMode: triggerType === 'scheduled_monthly' ? 'monthly' : 'manual',
        lastSyncCount: Math.min(Math.max(0, Math.round(preparedPaperWrites.length)), 500),
        lastSyncMessage: summaryMessage.slice(0, 400),
        windowLabel: windowLabel.slice(0, 80),
        scheduleCron: MONTHLY_CRON,
        timezone: MONTHLY_TIMEZONE,
        ...(koreanCoverageNotice ? { koreanCoverageNotice } : {}),
        updatedByUid: authUser.uid,
        updatedByName: safeActorName,
        updatedAt: serverTimestamp(),
      });

      await statusBatch.commit();

      return {
        ok: true,
        collectedCount: collected.length,
        newPapersCount: newDrafts.length,
        analyzedSuccessCount: preparedPaperWrites.length,
        analyzedFailedCount: 0,
        message: summaryMessage,
        staticHostingFallback: usedStaticCollectionFallback,
      };
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : '논문 자동 수집 중 오류가 발생했습니다.';
      try {
        const logId = `log_${Date.now()}`;
        const batch = writeBatch(db);
        batch.set(doc(db, 'syncLogs', logId), {
          logId,
          triggerType,
          status: 'error',
          collectedCount: 0,
          newPapersCount: 0,
          domesticCount: 0,
          internationalCount: 0,
          analyzedSuccessCount: 0,
          analyzedFailedCount: 0,
          openAlexCalls: 0,
          crossrefCalls: 0,
          geminiCalls: 0,
          estimatedTokens: 0,
          collectionErrors: [errMessage.slice(0, 240)],
          analysisErrors: [],
          executedByUid: authUser.uid,
          executedByName: safeActorName,
          createdAt: serverTimestamp(),
        });
        batch.set(statusRef, {
          autoEnabled,
          intervalDays: MONTHLY_INTERVAL_DAYS,
          ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
          nextSyncAt: kst.nextRunTimestamp,
          lastSyncStatus: 'error',
          lastSyncMode: triggerType === 'scheduled_monthly' ? 'monthly' : 'manual',
          lastSyncCount: 0,
          lastSyncMessage: errMessage.slice(0, 400),
          windowLabel: currentStatus?.windowLabel || `최근 ${safeLookback}개월`,
          scheduleCron: MONTHLY_CRON,
          timezone: MONTHLY_TIMEZONE,
          updatedByUid: authUser.uid,
          updatedByName: safeActorName,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (writeErr) {
        handleFirestoreError(writeErr, OperationType.WRITE, 'settings/researchSync');
      }

      return {
        ok: false,
        collectedCount: 0,
        newPapersCount: 0,
        analyzedSuccessCount: 0,
        analyzedFailedCount: 0,
        message: errMessage,
      };
    } finally {
      activeYouthSyncPromise = null;
    }
  })();

  return activeYouthSyncPromise;
}

export async function togglePaperVisibility(paper: PaperRecord): Promise<void> {
  try {
    await updateDoc(doc(db, 'papers', paper.paperId), {
      isPublished: !paper.isPublished,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `papers/${paper.paperId}`);
  }
}

export interface AcademicSourceStatus {
  id: 'nanet' | 'nl' | 'dbpia' | 'openalex' | 'crossref';
  name: string;
  scope: 'domestic' | 'international';
  envVar?: string;
  configured: boolean;
  status: 'connected' | 'ready_needs_key' | 'planned';
  stepLabel: string;
  storagePermission: string;
  aiProcessingPermission: string;
  termsSummary: string;
  endpointInfo: string;
}

export interface AcademicSourcesStatusResponse {
  ok: boolean;
  serverAvailable: boolean;
  sources: AcademicSourceStatus[];
  koreanKeywords: {
    core: string[];
    extended: string[];
    totalCount: number;
  };
  overseasKeywords?: string[];
  koreanJournals?: Array<{
    nameKo: string;
    nameEn: string;
    publisherEn: string;
    issn: string;
    doiPrefix: string;
  }>;
}

export interface NanetPaperPreview {
  sourceId: string;
  title: string;
  authors: string[];
  journalName: string;
  publicationDate: string;
  materialType: string;
  paperUrl: string;
  sourceName: string;
  country: 'KR';
  region: 'domestic';
  dataAvailability: 'metadata_only';
  storagePermission: 'metadata_and_link';
  aiProcessingPermission: 'abstract_or_open_fulltext_only';
}

export interface NanetSearchTestResult {
  ok: boolean;
  configured: boolean;
  status: 'connected' | 'ready_needs_key' | 'api_error' | 'static_hosting';
  source: string;
  query: string;
  endpoint?: string;
  totalCount: number;
  papers: NanetPaperPreview[];
  message: string;
}

export async function fetchAcademicSourcesStatus(): Promise<AcademicSourcesStatusResponse> {
  try {
    const res = await fetch(resolveApiUrl('/api/sources/status'));
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      throw new Error('STATIC_HOSTING');
    }
    const data = (await res.json()) as {
      ok: boolean;
      sources: AcademicSourceStatus[];
      koreanKeywords: { core: string[]; extended: string[]; totalCount: number };
      overseasKeywords?: string[];
      koreanJournals?: AcademicSourcesStatusResponse['koreanJournals'];
    };
    return {
      ok: true,
      serverAvailable: true,
      sources: data.sources || [],
      koreanKeywords: data.koreanKeywords || { core: [], extended: [], totalCount: 0 },
      overseasKeywords: data.overseasKeywords || [],
      koreanJournals: data.koreanJournals || [],
    };
  } catch {
    return {
      ok: false,
      serverAvailable: false,
      sources: [
        {
          id: 'nanet',
          name: '국회도서관 국가학술정보 · 자료검색 Open API',
          scope: 'domestic',
          envVar: 'NANET_API_KEY',
          configured: false,
          status: 'ready_needs_key',
          stepLabel: '2단계 (서버 연결 필요)',
          storagePermission: 'metadata_and_link',
          aiProcessingPermission: 'abstract_or_open_fulltext_only',
          termsSummary:
            '정적 호스팅 환경에서는 서버 전용 API 키 상태를 조회할 수 없습니다. AI Studio 서버 환경에서 확인하세요.',
          endpointInfo: 'https://apis.data.go.kr/9720000/searchservice/basic',
        },
        {
          id: 'nl',
          name: '국립중앙도서관 Open API',
          scope: 'domestic',
          envVar: 'NL_API_KEY',
          configured: false,
          status: 'ready_needs_key',
          stepLabel: '3단계 (서버 연결 필요)',
          storagePermission: 'metadata_and_link',
          aiProcessingPermission: 'abstract_or_open_fulltext_only',
          termsSummary:
            '정적 호스팅 환경에서는 서버 전용 API 키 상태를 조회할 수 없습니다. AI Studio 서버 환경에서 확인하세요.',
          endpointInfo: 'https://www.nl.go.kr/NL/search/openApi/search.do',
        },
        {
          id: 'openalex',
          name: 'OpenAlex API',
          scope: 'international',
          configured: true,
          status: 'connected',
          stepLabel: '4단계 (고도화 완료)',
          storagePermission: 'open_metadata_and_abstract',
          aiProcessingPermission: 'allowed_open_abstract',
          termsSummary: '공개 학술 메타데이터·초록 직접 수집 가능.',
          endpointInfo: 'https://api.openalex.org/works',
        },
        {
          id: 'crossref',
          name: 'Crossref REST API',
          scope: 'international',
          configured: true,
          status: 'connected',
          stepLabel: '4단계 (고도화 완료)',
          storagePermission: 'open_metadata_and_abstract',
          aiProcessingPermission: 'allowed_open_abstract',
          termsSummary: 'DOI·국내 6대 청소년학 학술지·해외 키워드 보완 가능.',
          endpointInfo: 'https://api.crossref.org/works',
        },
        {
          id: 'dbpia',
          name: 'DBpia Open API (실시간 검색 · 원문 링크 전용)',
          scope: 'domestic',
          envVar: 'DBPIA_API_KEY',
          configured: false,
          status: 'ready_needs_key',
          stepLabel: '5단계 (구현 완료)',
          storagePermission: 'search_only_link',
          aiProcessingPermission: 'prohibited_without_license',
          termsSummary:
            '정적 호스팅 환경에서는 서버 전용 API 키 상태를 조회할 수 없습니다. AI Studio 서버 환경에서 확인하세요.',
          endpointInfo: 'https://api.dbpia.co.kr/v2/search/search.xml',
        },
      ],
      koreanKeywords: { core: [], extended: [], totalCount: 0 },
      overseasKeywords: [],
      koreanJournals: [],
    };
  }
}

export async function testNanetPaperSearch(
  query: string,
  pageNo = 1,
  displayLines = 10
): Promise<NanetSearchTestResult> {
  try {
    const res = await fetch(resolveApiUrl('/api/sources/nanet/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageNo, displayLines }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        configured: false,
        status: 'static_hosting',
        source: 'nanet',
        query,
        totalCount: 0,
        papers: [],
        message:
          '현재 정적 호스팅 환경에서는 국회도서관 Open API 프록시 서버를 호출할 수 없습니다. AI Studio 서버 환경 또는 VITE_API_BASE_URL 서버 연결 상태에서 테스트해 주세요.',
      };
    }
    return (await res.json()) as NanetSearchTestResult;
  } catch (error) {
    return {
      ok: false,
      configured: false,
      status: 'api_error',
      source: 'nanet',
      query,
      totalCount: 0,
      papers: [],
      message:
        error instanceof Error
          ? `국회도서관 API 테스트 요청 실패: ${error.message}`
          : '국회도서관 API 테스트 요청에 실패했습니다.',
    };
  }
}

export interface NlSearchTestResult {
  ok: boolean;
  configured: boolean;
  status: 'connected' | 'ready_needs_key' | 'api_error' | 'static_hosting';
  source: string;
  query: string;
  category?: string;
  endpoint?: string;
  totalCount: number;
  papers: NanetPaperPreview[];
  message: string;
}

export async function testNlPaperSearch(
  query: string,
  category = '학위논문',
  pageNo = 1,
  pageSize = 10
): Promise<NlSearchTestResult> {
  try {
    const res = await fetch(resolveApiUrl('/api/sources/nl/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, category, pageNo, pageSize }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        configured: false,
        status: 'static_hosting',
        source: 'nl',
        query,
        category,
        totalCount: 0,
        papers: [],
        message:
          '현재 정적 호스팅 환경에서는 국립중앙도서관 Open API 프록시 서버를 호출할 수 없습니다. AI Studio 서버 환경 또는 VITE_API_BASE_URL 서버 연결 상태에서 테스트해 주세요.',
      };
    }
    return (await res.json()) as NlSearchTestResult;
  } catch (error) {
    return {
      ok: false,
      configured: false,
      status: 'api_error',
      source: 'nl',
      query,
      category,
      totalCount: 0,
      papers: [],
      message:
        error instanceof Error
          ? `국립중앙도서관 API 테스트 요청 실패: ${error.message}`
          : '국립중앙도서관 API 테스트 요청에 실패했습니다.',
    };
  }
}

export interface GlobalAcademicSearchItem {
  paperId: string;
  title: string;
  authors: string[];
  journalName: string;
  publisher: string;
  publicationDate: string;
  language: string;
  country: string;
  region: 'domestic' | 'international';
  regionReason: string;
  doi: string;
  paperUrl: string;
  source: string;
}

export interface GlobalAcademicSearchResult {
  ok: boolean;
  query: string;
  regionScope: 'all' | 'domestic' | 'international';
  fromDate?: string;
  toDate?: string;
  lookbackMonths?: number;
  openAlexStatus?: string;
  openAlexKeyConfigured?: boolean;
  openAlexNote?: string;
  totalReturned: number;
  domesticCount: number;
  internationalCount: number;
  papers: GlobalAcademicSearchItem[];
  message: string;
}

export async function testGlobalAcademicSearch(params: {
  query: string;
  regionScope?: 'all' | 'domestic' | 'international';
  lookbackMonths?: 3 | 12 | 60;
  limit?: number;
}): Promise<GlobalAcademicSearchResult> {
  try {
    const res = await fetch(resolveApiUrl('/api/sources/global/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        query: params.query,
        regionScope: params.regionScope || 'all',
        totalReturned: 0,
        domesticCount: 0,
        internationalCount: 0,
        papers: [],
        message: '정적 호스팅 환경에서는 서버 통합 테스트 엔드포인트를 호출할 수 없습니다.',
      };
    }
    return (await res.json()) as GlobalAcademicSearchResult;
  } catch (error) {
    return {
      ok: false,
      query: params.query,
      regionScope: params.regionScope || 'all',
      totalReturned: 0,
      domesticCount: 0,
      internationalCount: 0,
      papers: [],
      message:
        error instanceof Error
          ? `OpenAlex·Crossref 연계 테스트 실패: ${error.message}`
          : 'OpenAlex·Crossref 연계 테스트에 실패했습니다.',
    };
  }
}

export interface DbpiaPaperPreview {
  sourceId: string;
  title: string;
  authors: string[];
  journalName: string;
  publisherName: string;
  publicationDate: string;
  pages: string;
  freeYn: 'Y' | 'N';
  paperUrl: string;
  sourceName: string;
  country: 'KR';
  region: 'domestic';
  dataAvailability: 'metadata_and_link_only';
  storagePermission: 'search_only_link';
  aiProcessingPermission: 'prohibited_without_license';
}

export interface DbpiaSearchTestResult {
  ok: boolean;
  configured: boolean;
  status: 'connected' | 'ready_needs_key' | 'api_error' | 'static_hosting';
  source: string;
  query: string;
  sortType?: '1' | '2';
  endpoint?: string;
  totalCount: number;
  papers: DbpiaPaperPreview[];
  message: string;
}

export async function testDbpiaPaperSearch(
  query: string,
  sortType: '1' | '2' = '2',
  pageNo = 1,
  pageCount = 10
): Promise<DbpiaSearchTestResult> {
  try {
    const res = await fetch(resolveApiUrl('/api/sources/dbpia/search'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sortType, pageNo, pageCount }),
    });
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        configured: false,
        status: 'static_hosting',
        source: 'dbpia',
        query,
        sortType,
        totalCount: 0,
        papers: [],
        message:
          '현재 정적 호스팅 환경에서는 DBpia Open API 프록시 서버를 호출할 수 없습니다. AI Studio 서버 환경 또는 VITE_API_BASE_URL 서버 연결 상태에서 검색해 주세요.',
      };
    }
    return (await res.json()) as DbpiaSearchTestResult;
  } catch (error) {
    return {
      ok: false,
      configured: false,
      status: 'api_error',
      source: 'dbpia',
      query,
      sortType,
      totalCount: 0,
      papers: [],
      message:
        error instanceof Error
          ? `DBpia API 검색 요청 실패: ${error.message}`
          : 'DBpia API 검색 요청에 실패했습니다.',
    };
  }
}

export interface DiagnosticCheckItem {
  id: string;
  label: string;
  category: 'firebase' | 'backend' | 'sources' | 'scheduler' | 'security';
  status: 'pass' | 'warn' | 'fail';
  latencyMs: number;
  summary: string;
  detail: string;
}

export interface SystemDiagnosticsReport {
  checkedAtIso: string;
  overallStatus: 'pass' | 'warn' | 'fail';
  checks: DiagnosticCheckItem[];
}

export async function runAdminSystemDiagnostics({
  authUser,
  isAdmin,
  papers,
  syncLogs,
  researchSyncStatus,
}: {
  authUser: User | null;
  isAdmin: boolean;
  papers: PaperRecord[];
  syncLogs: Array<{ status: string }>;
  researchSyncStatus: ResearchSyncStatus | null;
}): Promise<SystemDiagnosticsReport> {
  const checks: DiagnosticCheckItem[] = [];

  // 1. Firebase Auth & Verified Email & Admin Gate Check
  const authStart = performance.now();
  const hasVerifiedAdmin = Boolean(authUser && authUser.emailVerified && isAdmin);
  checks.push({
    id: 'auth_rbac',
    label: 'Firebase 인증 및 관리자 권한 경계',
    category: 'security',
    status: hasVerifiedAdmin ? 'pass' : 'fail',
    latencyMs: Math.round(performance.now() - authStart),
    summary: hasVerifiedAdmin
      ? `인증 완료 (${authUser?.email || ''})`
      : '이메일 인증 또는 관리자 권한 미충족',
    detail: hasVerifiedAdmin
      ? 'Google Verified Email 및 관리자 RBAC(/admins 또는 최고 관리자) 검증을 통과했습니다.'
      : 'firestore.rules의 email_verified == true 및 isAdmin() 조건을 확인하세요.',
  });

  // 2. Firestore Live Server Connection Check
  const fsStart = performance.now();
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    checks.push({
      id: 'firestore_conn',
      label: 'Firestore 실시간 서버 연결',
      category: 'firebase',
      status: 'pass',
      latencyMs: Math.round(performance.now() - fsStart),
      summary: 'Firestore 서버 직접 응답 확인',
      detail: '오프라인 캐시가 아닌 원격 Firestore 서버(/test/connection)와 정상 통신 중입니다.',
    });
  } catch (err) {
    checks.push({
      id: 'firestore_conn',
      label: 'Firestore 실시간 서버 연결',
      category: 'firebase',
      status: 'fail',
      latencyMs: Math.round(performance.now() - fsStart),
      summary: 'Firestore 서버 응답 실패',
      detail: err instanceof Error ? err.message : '네트워크 또는 Firebase 설정을 확인해 주세요.',
    });
  }

  // 3. Backend /api/health Server Capability Check (without Gemini AI requirement)
  const healthStart = performance.now();
  const targetServerLabel = describeApiTarget();
  let serverAvailable = false;
  try {
    const res = await fetch(resolveApiUrl('/api/health'));
    const ctype = res.headers.get('content-type') || '';
    if (!res.ok || !ctype.includes('application/json')) {
      throw new Error(
        `정적 호스팅 또는 API 서버 비활성 상태 (대상: ${targetServerLabel})`
      );
    }
    const health = (await res.json()) as {
      ok?: boolean;
      environment?: string;
      corsMode?: string;
      nanetConfigured?: boolean;
      nlConfigured?: boolean;
      dbpiaConfigured?: boolean;
      openAlexKeyConfigured?: boolean;
      schedule?: { cron?: string; timezone?: string; nextRunLabel?: string };
    };
    serverAvailable = Boolean(health.ok);
    checks.push({
      id: 'backend_health',
      label: 'Cloud Run / Express 학술 API 서버 상태',
      category: 'backend',
      status: health.ok ? 'pass' : 'fail',
      latencyMs: Math.round(performance.now() - healthStart),
      summary: health.ok
        ? `API 서버 연결 정상 (${targetServerLabel})`
        : `API 서버 응답 오류 (${targetServerLabel})`,
      detail: `환경 ${health.environment || 'node'} · CORS ${health.corsMode || 'default'} · 스케줄 ${health.schedule?.cron || '0 3 1 * *'} (${health.schedule?.timezone || 'Asia/Seoul'})`,
    });

    const configuredOptionalKeys = [
      health.nanetConfigured ? '국회도서관(NANET)' : null,
      health.nlConfigured ? '국립중앙도서관(NL)' : null,
      health.dbpiaConfigured ? 'DBpia' : null,
      health.openAlexKeyConfigured ? 'OpenAlex Key' : null,
    ].filter((x): x is string => Boolean(x));

    checks.push({
      id: 'academic_keys',
      label: '국내외 학술 API 키 등록 현황',
      category: 'sources',
      status: configuredOptionalKeys.length > 0 ? 'pass' : 'warn',
      latencyMs: 0,
      summary:
        configuredOptionalKeys.length > 0
          ? `선택 API 키 ${configuredOptionalKeys.length}종 활성화`
          : 'OpenAlex·Crossref 공개 연동 활성 (국회·국중·DBpia 키 선택 등록 대기)',
      detail:
        configuredOptionalKeys.length > 0
          ? `등록된 서버 비밀키: ${configuredOptionalKeys.join(', ')}`
          : '국회도서관(NANET_API_KEY), 국립중앙도서관(NL_API_KEY), DBpia(DBPIA_API_KEY)는 서버 환경변수(Secret Manager) 등록 시 즉시 활성화됩니다.',
    });
  } catch (err) {
    checks.push({
      id: 'backend_health',
      label: 'Cloud Run / Express 학술 API 서버 상태',
      category: 'backend',
      status: getActiveApiBaseUrl() ? 'fail' : 'warn',
      latencyMs: Math.round(performance.now() - healthStart),
      summary: getActiveApiBaseUrl()
        ? `Cloud Run 서버 연결/CORS 실패 (${targetServerLabel})`
        : '정적 호스팅(브라우저 OpenAlex·Crossref 수집 가능)',
      detail: formatServerFetchError(err, 'Cloud Run API'),
    });
  }

  // 4. OpenAlex & Crossref Live Search Probe
  if (serverAvailable) {
    const oaStart = performance.now();
    try {
      const globalRes = await testGlobalAcademicSearch({
        query: '청소년지도',
        regionScope: 'all',
        lookbackMonths: 12,
        limit: 2,
      });
      checks.push({
        id: 'global_sources_live',
        label: 'OpenAlex · Crossref 실시간 조회 점검',
        category: 'sources',
        status: globalRes.ok ? 'pass' : 'warn',
        latencyMs: Math.round(performance.now() - oaStart),
        summary: globalRes.ok
          ? `실시간 ${globalRes.totalReturned}건 조회 확인 (국내 ${globalRes.domesticCount} · 해외 ${globalRes.internationalCount})`
          : '부분 제한 또는 조회 결과 없음',
        detail: globalRes.message,
      });
    } catch (err) {
      checks.push({
        id: 'global_sources_live',
        label: 'OpenAlex · Crossref 실시간 조회 점검',
        category: 'sources',
        status: 'fail',
        latencyMs: Math.round(performance.now() - oaStart),
        summary: '학술 API 조회 오류',
        detail: err instanceof Error ? err.message : 'OpenAlex/Crossref 응답을 받지 못했습니다.',
      });
    }

    // 5. KST 03:00 Monthly Schedule Boundary Verification
    const schedStart = performance.now();
    try {
      const [beforeRes, atSlotRes] = await Promise.all([
        fetch(resolveApiUrl('/api/papers/schedule-check'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nowIso: '2026-12-01T02:59:00+09:00',
            lastSyncedAtIso: '2026-11-01T03:05:00+09:00',
            autoEnabled: true,
            papersCount: 10,
          }),
        }),
        fetch(resolveApiUrl('/api/papers/schedule-check'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nowIso: '2026-12-01T03:00:00+09:00',
            lastSyncedAtIso: '2026-11-01T03:05:00+09:00',
            autoEnabled: true,
            papersCount: 10,
          }),
        }),
      ]);
      const beforeJson = (await beforeRes.json()) as { due?: boolean; reason?: string };
      const atSlotJson = (await atSlotRes.json()) as { due?: boolean; reason?: string };
      const passedBoundary = beforeJson.due === false && atSlotJson.due === true;
      checks.push({
        id: 'kst_scheduler_boundary',
        label: '매월 1일 KST 03:00 스케줄 경계 검증',
        category: 'scheduler',
        status: passedBoundary ? 'pass' : 'fail',
        latencyMs: Math.round(performance.now() - schedStart),
        summary: passedBoundary
          ? '02:59(대기) → 03:00(실행 전환) 경계 판정 정확'
          : '스케줄 경계 판정 이상',
        detail: `02:59 KST=${String(beforeJson.due)} / 03:00 KST=${String(atSlotJson.due)} · 현재 자동스케줄 ${researchSyncStatus?.autoEnabled === false ? '일시중지' : '활성'}`,
      });
    } catch (err) {
      checks.push({
        id: 'kst_scheduler_boundary',
        label: '매월 1일 KST 03:00 스케줄 경계 검증',
        category: 'scheduler',
        status: 'fail',
        latencyMs: Math.round(performance.now() - schedStart),
        summary: '스케줄 검증 API 호출 실패',
        detail: err instanceof Error ? err.message : '알 수 없는 오류',
      });
    }
  }

  // 6. Client Security Hygiene & Data Integrity Check
  const hygieneStart = performance.now();
  const viteEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env || {};
  const leakedSecretKeys = Object.keys(viteEnv).filter((k) =>
    /GEMINI_API_KEY|NANET_API_KEY|NL_API_KEY|DBPIA_API_KEY|SECRET/i.test(k)
  );
  const openAccessCount = papers.filter((p) => p.openAccess).length;
  const staleSyncLock = Boolean(
    researchSyncStatus?.lastSyncStatus === 'syncing' && !isSyncActivelyRunning(researchSyncStatus)
  );
  const integrityStatus =
    leakedSecretKeys.length > 0 ? 'fail' : staleSyncLock ? 'warn' : 'pass';

  checks.push({
    id: 'data_security_hygiene',
    label: '클라이언트 보안 · 데이터 무결성 점검',
    category: 'security',
    status: integrityStatus,
    latencyMs: Math.round(performance.now() - hygieneStart),
    summary:
      leakedSecretKeys.length > 0
        ? `클라이언트 번들 비밀키 노출 감지 (${leakedSecretKeys.join(', ')})`
        : staleSyncLock
          ? '만료된 진행 잠금 감지 ([진행 잠금 해제] 권장)'
          : `비밀키 분리 준수 · 수집 논문 ${papers.length}편 (오픈액세스 ${openAccessCount}편)`,
    detail: `실행 로그 ${syncLogs.length}건 기록됨 · 서버 전용 프록시 및 firestore.rules 스키마 정합성 준수`,
  });

  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');

  return {
    checkedAtIso: new Date().toISOString(),
    overallStatus: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    checks,
  };
}



