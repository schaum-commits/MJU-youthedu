import { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  LIMITS,
  MonthlyTrendReport,
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

interface AnalyzedPaperPayload {
  paperId: string;
  mainCategory: YouthResearchCategory;
  relatedCategories: YouthResearchCategory[];
  keywords: string[];
  researchPurpose: string;
  researchBackground: string;
  researchQuestion: string;
  researchMethod: string;
  researchTarget: string;
  researchFindings: string;
  researchLimitations: string;
  practicalImplications: string;
  policyImplications: string;
  easySummary: string;
  analysisBasis: string;
  analysisStatus: 'completed' | 'failed';
  analysisError?: string;
  aiAnalysisDate: string;
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

function resolveApiUrl(apiPath: string): string {
  const configuredBase = (
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_API_BASE_URL || ''
  )
    .trim()
    .replace(/\/$/, '');
  return configuredBase ? `${configuredBase}${apiPath}` : apiPath;
}

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

function detectDomesticPaper(params: {
  language?: string;
  title?: string;
  journalName?: string;
  abstract?: string;
  countryCodes?: string[];
}): boolean {
  const hasHangul = /[가-힣]/.test(
    `${params.title || ''} ${params.journalName || ''} ${params.abstract || ''}`
  );
  if (params.language === 'ko' || hasHangul) return true;
  if (params.countryCodes?.some((c) => c.toUpperCase() === 'KR')) return true;
  const journalLower = (params.journalName || '').toLowerCase();
  return (
    journalLower.includes('korean') ||
    journalLower.includes('korea') ||
    journalLower.includes('청소년')
  );
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
    source?: { display_name?: string | null; country_code?: string | null } | null;
  } | null;
  authorships?: Array<{
    author?: { display_name?: string | null } | null;
    countries?: string[];
  }>;
  keywords?: Array<{ display_name?: string | null }>;
  concepts?: Array<{ display_name?: string | null }>;
}

interface BrowserCrossrefItem {
  DOI?: string;
  URL?: string;
  title?: string[];
  'container-title'?: string[];
  author?: Array<{ given?: string; family?: string; name?: string }>;
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
  const safeMonths = Math.min(Math.max(Math.round(params.lookbackMonths || 3), 1), 24);
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

      const countryCodes = [
        ...(work.primary_location?.source?.country_code
          ? [work.primary_location.source.country_code]
          : []),
        ...(work.authorships?.flatMap((a) => a.countries || []) || []),
      ];
      const isDomestic = detectDomesticPaper({
        language,
        title,
        journalName,
        abstract,
        countryCodes,
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MONTHLY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dateInput);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = Number(getPart('year'));
  const month = Number(getPart('month'));
  const day = Number(getPart('day'));
  const hour = Number(getPart('hour'));

  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
  const currentMonthLabel = `${year}년 ${String(month).padStart(2, '0')}월`;
  const kstDateLabel = `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  const isPastScheduledSlotThisMonth = day > 1 || (day === 1 && hour >= 3);

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
    isPastScheduledSlotThisMonth,
    nextRunDate,
    nextRunTimestamp: Timestamp.fromDate(nextRunDate),
    nextRunLabel: `${nextYear}.${String(nextMonth).padStart(2, '0')}.01 03:00 (Asia/Seoul)`,
  };
}

export function isMonthlySyncDue({
  researchSyncStatus,
  papersCount,
}: {
  researchSyncStatus: ResearchSyncStatus | null;
  papersCount: number;
}): boolean {
  if (researchSyncStatus?.autoEnabled === false) return false;
  if (papersCount === 0) return true;
  if (!researchSyncStatus?.lastSyncedAt || researchSyncStatus.scheduleCron !== MONTHLY_CRON) {
    return true;
  }

  const nowCtx = getKstScheduleContext(new Date());
  if (!nowCtx.isPastScheduledSlotThisMonth) {
    return false;
  }

  const lastDate = researchSyncStatus.lastSyncedAt.toDate();
  const lastCtx = getKstScheduleContext(lastDate);
  return lastCtx.currentMonthKey < nowCtx.currentMonthKey;
}

export async function generateMonthlyTrendReport({
  papers,
  newPapersCount = 0,
  authUser,
  isPublished = true,
}: {
  papers: PaperRecord[];
  newPapersCount?: number;
  authUser: User;
  isPublished?: boolean;
}): Promise<{ ok: boolean; report?: MonthlyTrendReport; message: string }> {
  if (papers.length === 0) {
    return {
      ok: false,
      message: '보고서를 생성할 수집 논문이 아직 없습니다. 먼저 논문 수집을 실행해 주세요.',
    };
  }

  const kst = getKstScheduleContext();
  const payloadPapers = papers.slice(0, 35).map((p) => ({
    title: p.title,
    mainCategory: p.mainCategory,
    region: p.region,
    publicationDate: p.publicationDate,
    journalName: p.journalName,
    easySummary: p.easySummary || '',
    researchFindings: p.researchFindings || '',
    practicalImplications: p.practicalImplications || '',
  }));

  try {
    const res = await fetch(resolveApiUrl('/api/papers/report'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monthLabel: kst.currentMonthLabel,
        periodRange: `최근 수집 논문 ${papers.length}편 종합`,
        papers: payloadPapers,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        message:
          '정적 호스팅(GitHub Pages)에서는 AI 보고서 생성 서버를 호출할 수 없습니다. AI Studio 서버 주소(*.run.app)에서 실행해 주세요.',
      };
    }

    const data = (await res.json()) as {
      report?: {
        reportId: string;
        monthLabel: string;
        periodRange: string;
        categoryFlows: string;
        notablePapers: string;
        keyThemes: string;
        commonFindings: string;
        researchGaps: string;
        fieldImplications: string;
      };
      error?: string;
    };

    if (!res.ok || !data.report) {
      return {
        ok: false,
        message: data.error || `월간 보고서 생성 오류 (${res.status})`,
      };
    }

    const domesticCount = papers.filter((p) => p.region === 'domestic').length;
    const internationalCount = papers.length - domesticCount;
    const r = data.report;
    const reportId = r.reportId || `report_${kst.currentMonthKey.replace(/[^0-9]/g, '')}`;

    const reportRef = doc(db, 'monthlyReports', reportId);
    const existingReportSnap = await getDoc(reportRef);
    const reportFields = {
      reportId,
      monthLabel: (r.monthLabel || kst.currentMonthLabel).slice(0, 60),
      periodRange: (r.periodRange || '최근 수집 논문 종합').slice(0, 80),
      totalPapersCount: Math.max(0, Math.round(papers.length)),
      newPapersCount: Math.max(0, Math.round(newPapersCount)),
      domesticCount: Math.max(0, Math.round(domesticCount)),
      internationalCount: Math.max(0, Math.round(internationalCount)),
      categoryFlows: (r.categoryFlows || '분야별 연구 흐름이 정리되었습니다.').slice(0, 4000),
      notablePapers: (r.notablePapers || '주목할 만한 논문이 선정되었습니다.').slice(0, 3000),
      keyThemes: (r.keyThemes || '핵심 연구 주제가 도출되었습니다.').slice(0, 2500),
      commonFindings: (r.commonFindings || '공통 연구 결과가 요약되었습니다.').slice(0, 2500),
      researchGaps: (r.researchGaps || '후속 연구 과제가 정리되었습니다.').slice(0, 2500),
      fieldImplications: (r.fieldImplications || '청소년지도 현장 시사점이 정리되었습니다.').slice(
        0,
        2500
      ),
      isPublished,
      updatedAt: serverTimestamp(),
    };

    if (existingReportSnap.exists()) {
      await updateDoc(reportRef, reportFields);
    } else {
      await setDoc(reportRef, {
        ...reportFields,
        createdByUid: authUser.uid,
        createdAt: serverTimestamp(),
      });
    }

    return {
      ok: true,
      message: `${reportFields.monthLabel} 월간 연구동향 보고서가 생성되었습니다.`,
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : '월간 연구동향 보고서 생성 중 오류가 발생했습니다.',
    };
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
  generateReportToo = true,
}: {
  triggerType: 'manual' | 'scheduled_monthly';
  authUser: User;
  actorName: string;
  existingPapers: PaperRecord[];
  autoEnabled?: boolean;
  currentStatus?: ResearchSyncStatus | null;
  perCategoryLimit?: number;
  lookbackMonths?: number;
  generateReportToo?: boolean;
}): Promise<YouthSyncRunResult> {
  if (activeYouthSyncPromise) {
    return activeYouthSyncPromise;
  }

  activeYouthSyncPromise = (async (): Promise<YouthSyncRunResult> => {
    const kst = getKstScheduleContext();
    const statusRef = doc(db, 'settings', 'researchSync');
    const safeActorName = (actorName || '원우회 관리자').slice(0, LIMITS.displayName);
    const safeLookback = Math.min(Math.max(Math.round(lookbackMonths || 3), 1), 24);

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
        lastSyncCount: currentStatus?.lastSyncCount ?? 0,
        lastSyncMessage: `OpenAlex·Crossref에서 최근 ${safeLookback}개월 논문을 수집하고 있습니다...`,
        windowLabel: currentStatus?.windowLabel || `최근 ${safeLookback}개월`,
        scheduleCron: MONTHLY_CRON,
        timezone: MONTHLY_TIMEZONE,
        ...(currentStatus?.koreanCoverageNotice
          ? { koreanCoverageNotice: currentStatus.koreanCoverageNotice }
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

      const windowLabel = `${stats.fromDate} ~ ${stats.toDate} (최근 ${safeLookback}개월)`;
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

      let geminiCalls = 0;
      let estimatedTokens = 0;
      let analyzedSuccessCount = 0;
      let analyzedFailedCount = 0;
      let aiServerUnavailable = usedStaticCollectionFallback;
      let aiGlobalErrorMessage = '';
      const analysisErrors: string[] = [];
      const analyzedById = new Map<string, AnalyzedPaperPayload>();

      // Step 2: Try Gemini AI analysis on server if available, while still preserving collected papers if AI server is unavailable or errored
      if (newDrafts.length > 0 && !usedStaticCollectionFallback) {
        try {
          const analyzeRes = await fetch(resolveApiUrl('/api/papers/analyze'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ papers: newDrafts }),
          });

          const analyzeType = analyzeRes.headers.get('content-type') || '';
          if (!analyzeType.includes('application/json')) {
            aiServerUnavailable = true;
          } else {
            const analyzeJson = (await analyzeRes.json()) as {
              results?: AnalyzedPaperPayload[];
              stats?: {
                geminiCalls: number;
                estimatedTokens: number;
                analyzedSuccessCount: number;
                analyzedFailedCount: number;
                analysisErrors: string[];
              };
              error?: string;
            };

            if (!analyzeRes.ok) {
              aiGlobalErrorMessage =
                analyzeJson.error || `AI 논문 분석 서버 오류 (${analyzeRes.status})`;
              analysisErrors.push(aiGlobalErrorMessage.slice(0, 240));
            } else {
              const results = Array.isArray(analyzeJson.results) ? analyzeJson.results : [];
              results.forEach((r) => analyzedById.set(r.paperId, r));
              geminiCalls = analyzeJson.stats?.geminiCalls ?? results.length;
              estimatedTokens = analyzeJson.stats?.estimatedTokens ?? 0;
              analyzedSuccessCount = analyzeJson.stats?.analyzedSuccessCount ?? 0;
              analyzedFailedCount = analyzeJson.stats?.analyzedFailedCount ?? 0;
              analysisErrors.push(...sanitizeStringArray(analyzeJson.stats?.analysisErrors, 25, 240));
            }
          }
        } catch (aiErr) {
          aiGlobalErrorMessage =
            aiErr instanceof Error ? aiErr.message : 'AI 분석 서버 연결에 실패했습니다.';
          analysisErrors.push(aiGlobalErrorMessage.slice(0, 240));
        }
      }

      // Step 3: Save new papers, syncLog, and updated settings/researchSync
      const batch = writeBatch(db);
      const savedRecordsForReport: PaperRecord[] = [...existingPapers];

      newDrafts.forEach((draft) => {
        const ai = analyzedById.get(draft.paperId);
        const mainCategory = YOUTH_RESEARCH_CATEGORIES.includes(
          ai?.mainCategory as YouthResearchCategory
        )
          ? (ai!.mainCategory as YouthResearchCategory)
          : draft.hintCategory;
        const relatedCategories = sanitizeStringArray(ai?.relatedCategories, 6, 80).filter(
          (c): c is YouthResearchCategory =>
            YOUTH_RESEARCH_CATEGORIES.includes(c as YouthResearchCategory) && c !== mainCategory
        );
        const mergedKeywords = Array.from(
          new Set([
            ...sanitizeStringArray(ai?.keywords, 12, 80),
            ...sanitizeStringArray(draft.keywords, 12, 80),
          ])
        ).slice(0, 12);

        const defaultStatus = aiServerUnavailable
          ? 'pending'
          : aiGlobalErrorMessage
            ? 'failed'
            : ai?.analysisStatus || 'pending';

        const defaultBasis = ai?.analysisBasis
          ? ai.analysisBasis
          : draft.abstract.length >= 40
            ? '초록 수집 완료 (AI 분석 대기)'
            : '서지정보 수집 완료 (AI 분석 대기)';

        const paperDoc: Record<string, unknown> = {
          paperId: draft.paperId,
          title: draft.title.slice(0, 300),
          authors: sanitizeStringArray(draft.authors, 25, 120),
          journalName: (draft.journalName || '학술지 미상').slice(0, 200),
          publicationDate: (draft.publicationDate || kst.kstDateLabel.replace(/\./g, '-')).slice(
            0,
            20
          ),
          language: (draft.language || 'en').slice(0, 20),
          region: draft.region,
          abstract: (draft.abstract || '').slice(0, 8000),
          keywords: mergedKeywords,
          ...(draft.doi ? { doi: draft.doi.slice(0, 200) } : {}),
          ...(draft.openAlexId ? { openAlexId: draft.openAlexId.slice(0, 160) } : {}),
          ...(draft.crossrefId ? { crossrefId: draft.crossrefId.slice(0, 200) } : {}),
          ...(draft.paperUrl ? { paperUrl: draft.paperUrl.slice(0, 500) } : {}),
          source: (draft.source || 'OpenAlex').slice(0, 60),
          openAccess: Boolean(draft.openAccess),
          citedByCount: Math.max(0, Math.round(Number(draft.citedByCount || 0))),
          mainCategory,
          relatedCategories,
          analysisBasis: defaultBasis.slice(0, 100),
          analysisStatus: defaultStatus,
          isPublished: true,
          aiAnalysisDate: (ai?.aiAnalysisDate || new Date().toISOString().slice(0, 10)).slice(
            0,
            40
          ),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        if (ai?.researchPurpose) paperDoc.researchPurpose = ai.researchPurpose.slice(0, 1500);
        if (ai?.researchBackground) {
          paperDoc.researchBackground = ai.researchBackground.slice(0, 1500);
        }
        if (ai?.researchQuestion) paperDoc.researchQuestion = ai.researchQuestion.slice(0, 1000);
        if (ai?.researchMethod) paperDoc.researchMethod = ai.researchMethod.slice(0, 1500);
        if (ai?.researchTarget) paperDoc.researchTarget = ai.researchTarget.slice(0, 1000);
        if (ai?.researchFindings) paperDoc.researchFindings = ai.researchFindings.slice(0, 2500);
        if (ai?.researchLimitations) {
          paperDoc.researchLimitations = ai.researchLimitations.slice(0, 1500);
        }
        if (ai?.practicalImplications) {
          paperDoc.practicalImplications = ai.practicalImplications.slice(0, 2000);
        }
        if (ai?.policyImplications) paperDoc.policyImplications = ai.policyImplications.slice(0, 2000);
        if (ai?.easySummary) paperDoc.easySummary = ai.easySummary.slice(0, 2500);
        if (ai?.analysisError || aiGlobalErrorMessage) {
          paperDoc.analysisError = (ai?.analysisError || aiGlobalErrorMessage).slice(0, 500);
        } else if (aiServerUnavailable) {
          paperDoc.analysisError =
            '정적 호스팅(GitHub Pages)에서 서지와 초록이 먼저 수집되었습니다. AI Studio 서버 환경(*.run.app)에서 [대기·실패 논문 AI 분석]을 실행하면 AI 요약이 채워집니다.';
        }

        batch.set(doc(db, 'papers', draft.paperId), paperDoc);
        savedRecordsForReport.unshift(paperDoc as unknown as PaperRecord);
      });

      const domesticCount = newDrafts.filter((p) => p.region === 'domestic').length;
      const internationalCount = newDrafts.length - domesticCount;
      const logId = `log_${Date.now()}`;
      const pendingOrFailedCount = aiServerUnavailable || aiGlobalErrorMessage
        ? newDrafts.length
        : analyzedFailedCount;
      const logStatus =
        collectionErrors.length > 0 || pendingOrFailedCount > 0 ? 'partial' : 'success';

      batch.set(doc(db, 'syncLogs', logId), {
        logId,
        triggerType,
        status: logStatus,
        collectedCount: Math.max(0, Math.round(collected.length)),
        newPapersCount: Math.max(0, Math.round(newDrafts.length)),
        domesticCount: Math.max(0, Math.round(domesticCount)),
        internationalCount: Math.max(0, Math.round(internationalCount)),
        analyzedSuccessCount: Math.max(0, Math.round(analyzedSuccessCount)),
        analyzedFailedCount: Math.max(0, Math.round(pendingOrFailedCount)),
        openAlexCalls: Math.max(0, Math.round(stats.openAlexCalls ?? 0)),
        crossrefCalls: Math.max(0, Math.round(stats.crossrefCalls ?? 0)),
        geminiCalls: Math.max(0, Math.round(geminiCalls)),
        estimatedTokens: Math.max(0, Math.round(estimatedTokens)),
        collectionErrors,
        analysisErrors,
        ...(koreanCoverageNotice ? { koreanCoverageNotice } : {}),
        executedByUid: authUser.uid,
        executedByName: safeActorName,
        createdAt: serverTimestamp(),
      });

      let summaryMessage = '';
      if (newDrafts.length === 0) {
        summaryMessage = `최근 ${safeLookback}개월(${stats.fromDate} ~ ${stats.toDate}) OpenAlex·Crossref 논문을 점검했으며, 신규 미등록 논문이 없어 최신 상태입니다.`;
      } else if (aiServerUnavailable) {
        summaryMessage = `정적 호스팅 환경: OpenAlex·Crossref에서 최근 ${safeLookback}개월 신규 논문 ${newDrafts.length}편(국내 ${domesticCount} · 해외 ${internationalCount})의 서지·초록을 수집해 저장했습니다. AI 요약은 AI Studio 서버(*.run.app)에서 [AI 분석 실행]을 눌러 완료할 수 있습니다.`;
      } else if (aiGlobalErrorMessage) {
        summaryMessage = `최근 ${safeLookback}개월 신규 논문 ${newDrafts.length}편(국내 ${domesticCount} · 해외 ${internationalCount})이 저장되었으나 AI 분석이 보류되었습니다: ${aiGlobalErrorMessage}`;
      } else {
        summaryMessage = `최근 ${safeLookback}개월 신규 논문 ${newDrafts.length}편(국내 ${domesticCount} · 해외 ${internationalCount}) 수집 및 AI 분석 완료(${analyzedSuccessCount}성공 / ${analyzedFailedCount}실패).`;
      }

      batch.set(statusRef, {
        autoEnabled,
        intervalDays: MONTHLY_INTERVAL_DAYS,
        lastSyncedAt: serverTimestamp(),
        nextSyncAt: kst.nextRunTimestamp,
        lastSyncStatus: 'success',
        lastSyncMode: triggerType === 'scheduled_monthly' ? 'monthly' : 'manual',
        lastSyncCount: Math.max(0, Math.round(newDrafts.length)),
        lastSyncMessage: summaryMessage.slice(0, 400),
        windowLabel: windowLabel.slice(0, 80),
        scheduleCron: MONTHLY_CRON,
        timezone: MONTHLY_TIMEZONE,
        ...(koreanCoverageNotice ? { koreanCoverageNotice } : {}),
        updatedByUid: authUser.uid,
        updatedByName: safeActorName,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      if (
        generateReportToo &&
        !aiServerUnavailable &&
        !aiGlobalErrorMessage &&
        savedRecordsForReport.length > 0 &&
        newDrafts.length > 0
      ) {
        await generateMonthlyTrendReport({
          papers: savedRecordsForReport,
          newPapersCount: newDrafts.length,
          authUser,
          isPublished: true,
        });
      }

      return {
        ok: true,
        collectedCount: collected.length,
        newPapersCount: newDrafts.length,
        analyzedSuccessCount,
        analyzedFailedCount: pendingOrFailedCount,
        message: summaryMessage,
        staticHostingFallback: aiServerUnavailable,
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

export async function retryFailedPapers({
  failedPapers,
  authUser,
  actorName,
}: {
  failedPapers: PaperRecord[];
  authUser: User;
  actorName: string;
}): Promise<{ ok: boolean; successCount: number; failedCount: number; message: string }> {
  if (failedPapers.length === 0) {
    return {
      ok: true,
      successCount: 0,
      failedCount: 0,
      message: 'AI 분석이 필요한 대기·실패 논문이 없습니다.',
    };
  }

  const safeActorName = (actorName || '원우회 관리자').slice(0, LIMITS.displayName);

  try {
    const res = await fetch(resolveApiUrl('/api/papers/analyze'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        papers: failedPapers.slice(0, 16).map((p) => ({
          paperId: p.paperId,
          title: p.title,
          authors: p.authors,
          journalName: p.journalName,
          publicationDate: p.publicationDate,
          language: p.language,
          abstract: p.abstract,
          keywords: p.keywords,
          hintCategory: p.mainCategory,
        })),
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        successCount: 0,
        failedCount: failedPapers.length,
        message:
          '정적 호스팅(GitHub Pages)에서는 AI 분석 API 서버를 호출할 수 없습니다. AI Studio 서버 주소(*.run.app)에서 실행해 주세요.',
      };
    }

    const data = (await res.json()) as {
      results?: AnalyzedPaperPayload[];
      stats?: {
        geminiCalls: number;
        estimatedTokens: number;
        analyzedSuccessCount: number;
        analyzedFailedCount: number;
        analysisErrors: string[];
      };
      error?: string;
    };

    if (!res.ok) {
      throw new Error(data.error || `AI 분석 요청 오류 (${res.status})`);
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const batch = writeBatch(db);

    results.forEach((ai) => {
      const targetPaper = failedPapers.find((p) => p.paperId === ai.paperId);
      if (!targetPaper) return;
      const mainCategory = YOUTH_RESEARCH_CATEGORIES.includes(
        ai.mainCategory as YouthResearchCategory
      )
        ? ai.mainCategory
        : targetPaper.mainCategory;
      const relatedCategories = sanitizeStringArray(ai.relatedCategories, 6, 80).filter(
        (c): c is YouthResearchCategory =>
          YOUTH_RESEARCH_CATEGORIES.includes(c as YouthResearchCategory) && c !== mainCategory
      );

      const updateFields: Record<string, unknown> = {
        mainCategory,
        relatedCategories,
        keywords: Array.from(
          new Set([
            ...sanitizeStringArray(ai.keywords, 12, 80),
            ...sanitizeStringArray(targetPaper.keywords, 12, 80),
          ])
        ).slice(0, 12),
        analysisBasis: (ai.analysisBasis || '초록 기반 분석').slice(0, 100),
        analysisStatus: ai.analysisStatus,
        aiAnalysisDate: (ai.aiAnalysisDate || new Date().toISOString().slice(0, 10)).slice(0, 40),
        updatedAt: serverTimestamp(),
      };

      if (ai.researchPurpose) updateFields.researchPurpose = ai.researchPurpose.slice(0, 1500);
      if (ai.researchBackground) {
        updateFields.researchBackground = ai.researchBackground.slice(0, 1500);
      }
      if (ai.researchQuestion) updateFields.researchQuestion = ai.researchQuestion.slice(0, 1000);
      if (ai.researchMethod) updateFields.researchMethod = ai.researchMethod.slice(0, 1500);
      if (ai.researchTarget) updateFields.researchTarget = ai.researchTarget.slice(0, 1000);
      if (ai.researchFindings) updateFields.researchFindings = ai.researchFindings.slice(0, 2500);
      if (ai.researchLimitations) {
        updateFields.researchLimitations = ai.researchLimitations.slice(0, 1500);
      }
      if (ai.practicalImplications) {
        updateFields.practicalImplications = ai.practicalImplications.slice(0, 2000);
      }
      if (ai.policyImplications) {
        updateFields.policyImplications = ai.policyImplications.slice(0, 2000);
      }
      if (ai.easySummary) updateFields.easySummary = ai.easySummary.slice(0, 2500);
      updateFields.analysisError = ai.analysisError ? ai.analysisError.slice(0, 500) : '';

      batch.update(doc(db, 'papers', targetPaper.paperId), updateFields);
    });

    const logId = `log_${Date.now()}`;
    const successCount = data.stats?.analyzedSuccessCount ?? 0;
    const failedCount = data.stats?.analyzedFailedCount ?? 0;

    batch.set(doc(db, 'syncLogs', logId), {
      logId,
      triggerType: 'retry_failed',
      status: failedCount > 0 ? 'partial' : 'success',
      collectedCount: failedPapers.length,
      newPapersCount: 0,
      domesticCount: failedPapers.filter((p) => p.region === 'domestic').length,
      internationalCount: failedPapers.filter((p) => p.region === 'international').length,
      analyzedSuccessCount: successCount,
      analyzedFailedCount: failedCount,
      openAlexCalls: 0,
      crossrefCalls: 0,
      geminiCalls: data.stats?.geminiCalls ?? results.length,
      estimatedTokens: data.stats?.estimatedTokens ?? 0,
      collectionErrors: [],
      analysisErrors: sanitizeStringArray(data.stats?.analysisErrors, 25, 240),
      executedByUid: authUser.uid,
      executedByName: safeActorName,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    return {
      ok: true,
      successCount,
      failedCount,
      message: `대기·실패 논문 AI 분석 완료: ${successCount}건 성공, ${failedCount}건 실패`,
    };
  } catch (error) {
    return {
      ok: false,
      successCount: 0,
      failedCount: failedPapers.length,
      message: error instanceof Error ? error.message : '논문 AI 분석 중 오류가 발생했습니다.',
    };
  }
}

export async function togglePaperVisibility(paper: PaperRecord): Promise<void> {
  await updateDoc(doc(db, 'papers', paper.paperId), {
    isPublished: !paper.isPublished,
    updatedAt: serverTimestamp(),
  });
}
