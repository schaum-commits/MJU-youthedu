import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const GEMINI_MODEL = 'gemini-4-hydrogen';
const POLITE_USER_AGENT = 'MJU-YouthGuidance-Archive/1.0 (mailto:schaum@mju.ac.kr)';

const YOUTH_CATEGORIES = [
  '청소년지도 및 청소년 활동',
  '청소년 진로 및 리더십',
  '청소년 참여 및 사회적 성장',
  'AI 및 디지털 시대의 청소년',
  '청소년 교육 및 평생학습',
  '청소년 문제 및 사회 변화',
] as const;

type YouthResearchCategory = (typeof YOUTH_CATEGORIES)[number];

const CATEGORY_QUERIES: Array<{
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

const LEGACY_CATEGORIES = [
  '청소년정책·제도',
  '상담·심리지원',
  '디지털·미디어',
  '진로·자립지원',
  '학술논문·방법론',
  '학회·공모전',
] as const;

type LegacyTrendCategory = (typeof LEGACY_CATEGORIES)[number];

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

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' '));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim();
}

function normalizeDoi(doi?: string | null): string {
  if (!doi) return '';
  return doi
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .toLowerCase();
}

function makeSafePaperId(openAlexId: string, doi: string, title: string): string {
  const oaTail = openAlexId.split('/').pop() || '';
  if (/^[a-zA-Z0-9_-]{3,60}$/.test(oaTail)) {
    return `oa_${oaTail}`;
  }
  const input = doi || normalizeText(title);
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

function reconstructInvertedAbstract(index?: Record<string, number[]> | null): string {
  if (!index || typeof index !== 'object') return '';
  let maxPos = -1;
  for (const positions of Object.values(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos > maxPos) {
        maxPos = pos;
      }
    }
  }
  if (maxPos < 0 || maxPos > 6000) return '';
  const words = new Array<string>(maxPos + 1).fill('');
  for (const [token, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos >= 0 && pos <= maxPos) {
        words[pos] = token;
      }
    }
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
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
  if (
    journalLower.includes('korean') ||
    journalLower.includes('korea') ||
    journalLower.includes('청소년')
  ) {
    return true;
  }
  return false;
}

function getDateRangeByMonths(months: number) {
  const safeMonths = Math.min(Math.max(Math.round(months || 12), 1), 24);
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const from = new Date(now);
  from.setMonth(from.getMonth() - safeMonths);
  const fromDate = from.toISOString().slice(0, 10);
  return { fromDate, toDate, lookbackMonths: safeMonths };
}

function getKstScheduleInfo() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '00';
  const year = Number(getPart('year'));
  const month = Number(getPart('month'));
  const day = Number(getPart('day'));
  const hour = Number(getPart('hour'));

  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
  let nextYear = year;
  let nextMonth = month;
  if (day > 1 || (day === 1 && hour >= 3)) {
    nextMonth += 1;
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
  }
  const nextRunKstLabel = `${nextYear}.${String(nextMonth).padStart(2, '0')}.01 03:00 (Asia/Seoul)`;

  return {
    cron: '0 3 1 * *',
    timezone: 'Asia/Seoul',
    currentMonthKey,
    kstNowLabel: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')} ${getPart('hour')}:${getPart('minute')} KST`,
    nextRunKstLabel,
  };
}

function mapGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === 'GEMINI_API_KEY_MISSING') {
    return {
      status: 500,
      message:
        'GEMINI_API_KEY가 설정되지 않았습니다. Settings > Secrets 패널에서 Gemini API 키를 확인해 주세요.',
    };
  }
  if (
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('API key not valid') ||
    raw.includes('API key should be set')
  ) {
    return {
      status: 502,
      message:
        'Gemini API 키가 유효하지 않거나 권한이 없습니다. Settings > Secrets 패널에서 API 키 상태를 확인해 주세요.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('"code":429')) {
    return {
      status: 429,
      message: 'Gemini API 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',
    };
  }
  if (raw.includes('NOT_FOUND') || raw.includes('"code":404')) {
    return {
      status: 502,
      message: 'Gemini 모델 요청이 지원되지 않았습니다. 모델 설정을 확인해 주세요.',
    };
  }
  return {
    status: 500,
    message: `AI 분석 요청 처리 중 오류가 발생했습니다: ${raw.slice(0, 180)}`,
  };
}

// ---------- OpenAlex + Crossref Paper Collection ----------

interface OpenAlexWork {
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

async function fetchOpenAlexWorks(params: {
  filter: string;
  page?: number;
  perPage?: number;
}): Promise<OpenAlexWork[]> {
  const qs = new URLSearchParams({
    filter: params.filter,
    sort: 'publication_date:desc',
    page: String(params.page ?? 1),
    'per-page': String(params.perPage ?? 5),
  });
  const apiKey = process.env.OPENALEX_API_KEY?.trim();
  if (apiKey) {
    qs.set('api_key', apiKey);
  }
  const url = `https://api.openalex.org/works?${qs.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': POLITE_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`OpenAlex HTTP ${res.status}`);
  }
  const json = (await res.json()) as { results?: OpenAlexWork[] };
  return Array.isArray(json.results) ? json.results : [];
}

interface CrossrefWorkItem {
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

function formatCrossrefDate(item: CrossrefWorkItem): string {
  const parts =
    item.published?.['date-parts']?.[0] ||
    item['published-online']?.['date-parts']?.[0] ||
    item['published-print']?.['date-parts']?.[0];
  if (!parts || parts.length === 0) return '';
  const y = String(parts[0]);
  const m = parts[1] ? String(parts[1]).padStart(2, '0') : '01';
  const d = parts[2] ? String(parts[2]).padStart(2, '0') : '01';
  return `${y}-${m}-${d}`;
}

async function fetchCrossrefByDoi(doi: string): Promise<CrossrefWorkItem | null> {
  const cleanDoi = normalizeDoi(doi);
  if (!cleanDoi) return null;
  try {
    const res = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}`,
      {
        headers: { 'User-Agent': POLITE_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { message?: CrossrefWorkItem };
    return json.message || null;
  } catch {
    return null;
  }
}

async function handleCollectPapers(req: Request, res: Response) {
  const body = (req.body || {}) as {
    existingDois?: string[];
    existingOpenAlexIds?: string[];
    existingTitles?: string[];
    perCategoryLimit?: number;
    lookbackMonths?: number;
  };

  const existingDoiSet = new Set(
    (Array.isArray(body.existingDois) ? body.existingDois : []).map((d) => normalizeDoi(String(d))).filter(Boolean)
  );
  const existingOaSet = new Set(
    (Array.isArray(body.existingOpenAlexIds) ? body.existingOpenAlexIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean)
  );
  const existingTitleSet = new Set(
    (Array.isArray(body.existingTitles) ? body.existingTitles : [])
      .map((t) => normalizeText(String(t)))
      .filter(Boolean)
  );

  const perCategoryLimit = Math.min(Math.max(Number(body.perCategoryLimit || 3), 1), 6);
  const { fromDate, toDate, lookbackMonths } = getDateRangeByMonths(
    Number(body.lookbackMonths || 12)
  );

  let openAlexCalls = 0;
  let crossrefCalls = 0;
  const collectionErrors: string[] = [];

  const candidateMap = new Map<string, { work: OpenAlexWork; hintCategory: YouthResearchCategory }>();

  // 1. Collect per-category international & Korean papers with pagination support
  for (const cfg of CATEGORY_QUERIES) {
    try {
      openAlexCalls += 1;
      const enResults = await fetchOpenAlexWorks({
        filter: `from_publication_date:${fromDate},to_publication_date:${toDate},title_and_abstract.search:${cfg.enQuery}`,
        page: 1,
        perPage: Math.min(perCategoryLimit + 2, 6),
      });
      for (const work of enResults) {
        if (work.id && !candidateMap.has(work.id)) {
          candidateMap.set(work.id, { work, hintCategory: cfg.category });
        }
      }
    } catch (err) {
      collectionErrors.push(
        `OpenAlex 영문 수집 오류(${cfg.category}): ${err instanceof Error ? err.message : String(err)}`
      );
    }

    try {
      openAlexCalls += 1;
      const koResults = await fetchOpenAlexWorks({
        filter: `from_publication_date:${fromDate},to_publication_date:${toDate},language:ko,default.search:${cfg.koQuery}`,
        page: 1,
        perPage: Math.min(perCategoryLimit + 1, 5),
      });
      for (const work of koResults) {
        if (work.id && !candidateMap.has(work.id)) {
          candidateMap.set(work.id, { work, hintCategory: cfg.category });
        }
      }
    } catch (err) {
      collectionErrors.push(
        `OpenAlex 국문 수집 오류(${cfg.category}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 2. If Korean domestic papers are low, expand search terms with broader Korean youth queries (pagination page 1-2)
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
        const broadKo = await fetchOpenAlexWorks({
          filter: `from_publication_date:${fromDate},to_publication_date:${toDate},language:ko,default.search:청소년|청년|진로|디지털|학교`,
          page,
          perPage: 6,
        });
        for (const work of broadKo) {
          if (work.id && !candidateMap.has(work.id)) {
            candidateMap.set(work.id, {
              work,
              hintCategory: '청소년지도 및 청소년 활동',
            });
          }
        }
      }
    } catch (err) {
      collectionErrors.push(
        `OpenAlex 국내 논문 확장 검색 오류: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // 3. Deduplicate and select candidates before Crossref enrichment
  const freshEntries: Array<{ work: OpenAlexWork; hintCategory: YouthResearchCategory }> = [];
  for (const entry of candidateMap.values()) {
    const title = (entry.work.title || entry.work.display_name || '').trim();
    const oaId = (entry.work.id || '').trim();
    const doi = normalizeDoi(entry.work.doi);
    const normTitle = normalizeText(title);

    if (!title || title.length < 3) continue;
    if (oaId && existingOaSet.has(oaId)) continue;
    if (doi && existingDoiSet.has(doi)) continue;
    if (existingTitleSet.has(normTitle)) continue;

    existingTitleSet.add(normTitle);
    if (oaId) existingOaSet.add(oaId);
    if (doi) existingDoiSet.add(doi);

    freshEntries.push(entry);
    if (freshEntries.length >= 16) break;
  }

  // 4. Enrich with Crossref REST API (DOI, authors, journal, publicationDate, abstract, URL)
  const enrichedPapers: CollectedPaperDraft[] = await Promise.all(
    freshEntries.map(async ({ work, hintCategory }) => {
      const doiClean = normalizeDoi(work.doi);
      let crItem: CrossrefWorkItem | null = null;
      if (doiClean) {
        crossrefCalls += 1;
        crItem = await fetchCrossrefByDoi(doiClean);
      }

      const title = (
        work.title ||
        work.display_name ||
        crItem?.title?.[0] ||
        '제목 미상'
      )
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

      const publicationDate = (
        work.publication_date ||
        formatCrossrefDate(crItem || {}) ||
        toDate
      ).slice(0, 20);

      const oaAbstract = reconstructInvertedAbstract(work.abstract_inverted_index);
      const crAbstract = crItem?.abstract ? stripTags(crItem.abstract) : '';
      const abstract = (oaAbstract || crAbstract || '').slice(0, 8000);

      const language = (work.language || crItem?.language || (/[가-힣]/.test(title) ? 'ko' : 'en')).slice(
        0,
        20
      );
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

      const paperId = makeSafePaperId(openAlexId, doiClean, title);

      return {
        paperId,
        title,
        authors,
        journalName,
        publicationDate,
        language,
        region: isDomestic ? 'domestic' : 'international',
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
      ? '국내 학술지의 OpenAlex·Crossref 색인 시차로 인해 일부 최신 국내 논문이 수집되지 않았을 수 있습니다. 추가 국내 논문은 각 논문 또는 상단의 구글 학술검색(Google Scholar) 바로가기를 통해 함께 확인하실 수 있습니다.'
      : '';

  res.json({
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
      lookbackMonths,
    },
  });
}

// ---------- Gemini AI Classification & Structured Paper Analysis ----------

async function analyzeSinglePaperWithGemini(
  ai: GoogleGenAI,
  paper: {
    paperId: string;
    title: string;
    authors?: string[];
    journalName?: string;
    publicationDate?: string;
    language?: string;
    abstract?: string;
    keywords?: string[];
    hintCategory?: YouthResearchCategory;
  }
): Promise<{ result: AnalyzedPaperPayload; tokensUsed: number }> {
  const hasAbstract = Boolean(paper.abstract && paper.abstract.trim().length >= 40);
  const analysisBasis = hasAbstract ? '초록 기반 분석' : '제목·서지정보 기반 제한 분석';
  const aiAnalysisDate = new Date().toISOString().slice(0, 10);

  const prompt = [
    `당신은 명지대학교 대학원 청소년지도학과 연구정보 플랫폼의 AI 학술 분석가입니다.`,
    `아래 제공된 실제 학술논문의 확인 가능한 정보(제목, 초록, 키워드, 학술지명)만을 바탕으로 분석 결과를 작성하세요.`,
    ``,
    `[엄격한 AI 분석 원칙 - 반드시 준수]`,
    `1. 원문이나 초록에서 확인되지 않는 내용(표본 수, 통계 수치, 설문 문항, 세부 실험 조건 등)을 절대 만들어 내지 마세요.`,
    `2. 원문 전문에 접근할 수 없으므로 절대로 원문 전체를 읽은 것처럼 서술하지 마세요.`,
    `3. 연구의 한계(researchLimitations)가 초록에 명시되지 않았으면 임의로 추측해 쓰지 말고 반드시 "초록에서 명시적 연구 한계가 확인되지 않았습니다."라고 적으세요.`,
    `4. researchFindings에는 저자가 보고한 확인된 연구 결과만 객관적으로 적고, AI의 현장/정책 해석은 반드시 practicalImplications와 policyImplications에 구분하여 작성하세요.`,
    `5. 신뢰도 퍼센트나 점수를 임의의 숫자로 표현하지 마세요.`,
    `6. 모든 분석 텍스트는 한국어로 명확하게 작성하세요 (논문 제목이 영문인 경우에도 한국어로 알기 쉽게 설명).`,
    ``,
    `[6개 연구 분야 분류 기준]`,
    `- 청소년지도 및 청소년 활동: 청소년지도, 청소년활동, 청소년지도자, 수련활동, 청소년시설, 청소년 정책`,
    `- 청소년 진로 및 리더십: 진로개발, 진로교육, 진로탐색, 리더십, 자기주도성, 청소년 역량`,
    `- 청소년 참여 및 사회적 성장: 청소년 참여, 참여권, 자치활동, 시민성, 민주시민교육, 봉사활동, 공동체`,
    `- AI 및 디지털 시대의 청소년: 생성형 AI, 인공지능 교육, 디지털 리터러시, 미디어 교육, 디지털 시민성, 온라인 청소년활동`,
    `- 청소년 교육 및 평생학습: 청소년 교육, 평생교육, 비형식교육, 체험학습, 프로젝트 학습, 교육 프로그램 개발`,
    `- 청소년 문제 및 사회 변화: 학교 밖 청소년, 청소년 복지, 세대 변화, 사회적 고립, 사회적 불평등, 가족/또래 관계`,
    ``,
    `[분석 대상 논문 자료]`,
    JSON.stringify(
      {
        title: paper.title,
        journalName: paper.journalName || '',
        publicationDate: paper.publicationDate || '',
        language: paper.language || '',
        keywords: paper.keywords || [],
        abstract: hasAbstract ? paper.abstract : '(초록 제공되지 않음 — 제목과 서지정보 범위 내에서만 보수적으로 정리하세요)',
        analysisBasis,
      },
      null,
      2
    ),
  ].join('\n');

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          mainCategory: { type: Type.STRING, enum: [...YOUTH_CATEGORIES] },
          relatedCategories: {
            type: Type.ARRAY,
            items: { type: Type.STRING, enum: [...YOUTH_CATEGORIES] },
          },
          keywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
          },
          researchPurpose: { type: Type.STRING },
          researchBackground: { type: Type.STRING },
          researchQuestion: { type: Type.STRING },
          researchMethod: { type: Type.STRING },
          researchTarget: { type: Type.STRING },
          researchFindings: { type: Type.STRING },
          researchLimitations: { type: Type.STRING },
          practicalImplications: { type: Type.STRING },
          policyImplications: { type: Type.STRING },
          easySummary: { type: Type.STRING },
        },
        required: [
          'mainCategory',
          'relatedCategories',
          'keywords',
          'researchPurpose',
          'researchBackground',
          'researchQuestion',
          'researchMethod',
          'researchTarget',
          'researchFindings',
          'researchLimitations',
          'practicalImplications',
          'policyImplications',
          'easySummary',
        ],
      },
    },
  });

  const tokensUsed = Number(response.usageMetadata?.totalTokenCount || 0);
  const parsed = JSON.parse((response.text ?? '{}').trim()) as Partial<AnalyzedPaperPayload>;

  const mainCategory = YOUTH_CATEGORIES.includes(parsed.mainCategory as YouthResearchCategory)
    ? (parsed.mainCategory as YouthResearchCategory)
    : paper.hintCategory || '청소년지도 및 청소년 활동';

  const relatedCategories = Array.from(
    new Set(
      (Array.isArray(parsed.relatedCategories) ? parsed.relatedCategories : []).filter(
        (c): c is YouthResearchCategory =>
          YOUTH_CATEGORIES.includes(c as YouthResearchCategory) && c !== mainCategory
      )
    )
  ).slice(0, 4);

  const keywords = Array.from(
    new Set([
      ...(Array.isArray(parsed.keywords) ? parsed.keywords : []),
      ...(paper.keywords || []),
    ].map((k) => String(k).trim()).filter(Boolean))
  ).slice(0, 8);

  return {
    tokensUsed,
    result: {
      paperId: paper.paperId,
      mainCategory,
      relatedCategories,
      keywords,
      researchPurpose: String(parsed.researchPurpose || '').trim().slice(0, 1500),
      researchBackground: String(parsed.researchBackground || '').trim().slice(0, 1500),
      researchQuestion: String(parsed.researchQuestion || '').trim().slice(0, 1000),
      researchMethod: String(parsed.researchMethod || '').trim().slice(0, 1500),
      researchTarget: String(parsed.researchTarget || '').trim().slice(0, 1000),
      researchFindings: String(parsed.researchFindings || '').trim().slice(0, 2500),
      researchLimitations: String(
        parsed.researchLimitations || '초록에서 명시적 연구 한계가 확인되지 않았습니다.'
      )
        .trim()
        .slice(0, 1500),
      practicalImplications: String(parsed.practicalImplications || '').trim().slice(0, 2000),
      policyImplications: String(parsed.policyImplications || '').trim().slice(0, 2000),
      easySummary: String(parsed.easySummary || '').trim().slice(0, 2500),
      analysisBasis,
      analysisStatus: 'completed',
      aiAnalysisDate,
    },
  };
}

async function handleAnalyzePapers(req: Request, res: Response) {
  const body = (req.body || {}) as {
    papers?: Array<{
      paperId: string;
      title: string;
      authors?: string[];
      journalName?: string;
      publicationDate?: string;
      language?: string;
      abstract?: string;
      keywords?: string[];
      hintCategory?: YouthResearchCategory;
    }>;
  };

  const papers = Array.isArray(body.papers) ? body.papers.slice(0, 16) : [];
  if (papers.length === 0) {
    res.status(400).json({ error: '분석할 논문 목록이 비어 있습니다.' });
    return;
  }

  let ai: GoogleGenAI;
  try {
    ai = getGeminiClient();
  } catch (err) {
    const mapped = mapGeminiErrorMessage(err);
    res.status(mapped.status).json({ error: mapped.message });
    return;
  }

  let geminiCalls = 0;
  let estimatedTokens = 0;
  const results: AnalyzedPaperPayload[] = [];
  const analysisErrors: string[] = [];

  for (const paper of papers) {
    try {
      geminiCalls += 1;
      const { result, tokensUsed } = await analyzeSinglePaperWithGemini(ai, paper);
      estimatedTokens += tokensUsed;
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('API_KEY_INVALID') ||
        msg.includes('API key not valid') ||
        msg.includes('GEMINI_API_KEY_MISSING')
      ) {
        const mapped = mapGeminiErrorMessage(err);
        res.status(mapped.status).json({ error: mapped.message });
        return;
      }
      analysisErrors.push(`${paper.title.slice(0, 40)}: ${msg.slice(0, 120)}`);
      results.push({
        paperId: paper.paperId,
        mainCategory: paper.hintCategory || '청소년지도 및 청소년 활동',
        relatedCategories: [],
        keywords: (paper.keywords || []).slice(0, 6),
        researchPurpose: '',
        researchBackground: '',
        researchQuestion: '',
        researchMethod: '',
        researchTarget: '',
        researchFindings: '',
        researchLimitations: '',
        practicalImplications: '',
        policyImplications: '',
        easySummary: '',
        analysisBasis: paper.abstract ? '초록 기반 분석(대기)' : '서지정보 기반 분석(대기)',
        analysisStatus: 'failed',
        analysisError: msg.slice(0, 400),
        aiAnalysisDate: new Date().toISOString().slice(0, 10),
      });
    }
  }

  res.json({
    results,
    stats: {
      geminiCalls,
      estimatedTokens,
      analyzedSuccessCount: results.filter((r) => r.analysisStatus === 'completed').length,
      analyzedFailedCount: results.filter((r) => r.analysisStatus === 'failed').length,
      analysisErrors: analysisErrors.slice(0, 25),
    },
  });
}

async function handleGenerateMonthlyReport(req: Request, res: Response) {
  const body = (req.body || {}) as {
    monthLabel?: string;
    periodRange?: string;
    papers?: Array<{
      title: string;
      mainCategory: string;
      region: string;
      publicationDate: string;
      journalName: string;
      easySummary?: string;
      researchFindings?: string;
      practicalImplications?: string;
    }>;
  };

  const papers = Array.isArray(body.papers) ? body.papers.slice(0, 40) : [];
  if (papers.length === 0) {
    res.status(400).json({ error: '월간 보고서를 생성할 수집 논문이 없습니다.' });
    return;
  }

  try {
    const ai = getGeminiClient();
    const schedule = getKstScheduleInfo();
    const monthLabel = body.monthLabel || `${schedule.currentMonthKey.replace('-', '년 ')}월`;
    const periodRange = body.periodRange || '최근 12개월 수집 논문 종합';

    const prompt = [
      `당신은 명지대학교 대학원 청소년지도학과 연구정보 플랫폼의 월간 연구동향 보고서 편집자입니다.`,
      `아래 실제 수집된 논문들의 제목, 분야, 요약 및 확인된 결과를 종합하여 '${monthLabel} 청소년지도 최신 연구동향 보고서'를 한국어로 작성하세요.`,
      `반드시 제공된 논문 목록에 있는 내용만 근거로 작성하고, 없는 논문이나 수치를 지어내지 마세요.`,
      ``,
      `[수집된 논문 목록 (${papers.length}편)]`,
      JSON.stringify(papers, null, 2).slice(0, 16000),
    ].join('\n');

    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categoryFlows: { type: Type.STRING },
            notablePapers: { type: Type.STRING },
            keyThemes: { type: Type.STRING },
            commonFindings: { type: Type.STRING },
            researchGaps: { type: Type.STRING },
            fieldImplications: { type: Type.STRING },
          },
          required: [
            'categoryFlows',
            'notablePapers',
            'keyThemes',
            'commonFindings',
            'researchGaps',
            'fieldImplications',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as Record<string, string>;
    const tokensUsed = Number(response.usageMetadata?.totalTokenCount || 0);

    res.json({
      report: {
        reportId: `report_${schedule.currentMonthKey.replace(/[^0-9]/g, '')}`,
        monthLabel,
        periodRange,
        categoryFlows: String(parsed.categoryFlows || '').trim().slice(0, 4000),
        notablePapers: String(parsed.notablePapers || '').trim().slice(0, 3000),
        keyThemes: String(parsed.keyThemes || '').trim().slice(0, 2500),
        commonFindings: String(parsed.commonFindings || '').trim().slice(0, 2500),
        researchGaps: String(parsed.researchGaps || '').trim().slice(0, 2500),
        fieldImplications: String(parsed.fieldImplications || '').trim().slice(0, 2500),
      },
      tokensUsed,
    });
  } catch (err) {
    const mapped = mapGeminiErrorMessage(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
}

// ---------- Existing Member Research Archive Google Scholar Sync ----------

interface GroundedPageMetadata {
  requestedUrl: string;
  resolvedUrl: string;
  chunkTitle: string;
  metaTitle: string;
  journal: string;
  authors: string[];
  publishedPeriod: string;
  abstractSnippet: string;
}

interface SyncedPaperPayload {
  title: string;
  category: LegacyTrendCategory;
  source: string;
  publishedPeriod: string;
  externalUrl: string;
  summary: string;
  keyTakeaway: string;
}

function formatYearMonth(rawDate: string): string {
  const match = rawDate.match(/(\d{4})\D*(\d{1,2})?/);
  if (!match) return '';
  const year = match[1];
  const month = match[2] ? match[2].padStart(2, '0') : '01';
  return `${year}.${month}`;
}

function parseMonthIndex(ym: string): number | null {
  const m = ym.match(/(\d{4})\.(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 12 + Number(m[2]);
}

function getDateWindow(mode: 'initial_1y' | 'biweekly') {
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;
  const endYm = `${endYear}.${String(endMonth).padStart(2, '0')}`;

  const startDate = new Date(now);
  if (mode === 'initial_1y') {
    startDate.setFullYear(startDate.getFullYear() - 1);
  } else {
    startDate.setDate(startDate.getDate() - 45);
  }
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth() + 1;
  const startYm = `${startYear}.${String(startMonth).padStart(2, '0')}`;

  return {
    startYm,
    endYm,
    cutoffMonthIdx: startYear * 12 + startMonth - 1,
    windowLabel:
      mode === 'initial_1y'
        ? `최근 1년 (${startYm} ~ ${endYm})`
        : `정기 업데이트 (${startYm} ~ ${endYm})`,
  };
}

async function resolveGroundedUrlMetadata(
  uri: string,
  chunkTitle: string
): Promise<GroundedPageMetadata | null> {
  try {
    const res = await fetch(uri, {
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(7000),
    });

    const resolvedUrl = res.url || uri;
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('text/html')) {
      return {
        requestedUrl: uri,
        resolvedUrl,
        chunkTitle,
        metaTitle: chunkTitle,
        journal: '',
        authors: [],
        publishedPeriod: '',
        abstractSnippet: '',
      };
    }

    const html = await res.text();
    const getMetaValues = (name: string): string[] => {
      const values: string[] = [];
      const regex = new RegExp(
        `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>|<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`,
        'gi'
      );
      for (const m of html.matchAll(regex)) {
        const val = decodeHtmlEntities(m[1] ?? m[2] ?? '');
        if (val) values.push(val);
      }
      return values;
    };

    const metaTitle =
      getMetaValues('citation_title')[0] || getMetaValues('og:title')[0] || chunkTitle;
    const journal =
      getMetaValues('citation_journal_title')[0] || getMetaValues('og:site_name')[0] || '';
    const authors = getMetaValues('citation_author');
    const publishedPeriod = formatYearMonth(getMetaValues('citation_publication_date')[0] || '');
    const abstractSnippet = (getMetaValues('description')[0] || '').slice(0, 700);

    return {
      requestedUrl: uri,
      resolvedUrl,
      chunkTitle,
      metaTitle,
      journal,
      authors,
      publishedPeriod,
      abstractSnippet,
    };
  } catch {
    return null;
  }
}

async function handleLegacyResearchSync(req: Request, res: Response) {
  const body = (req.body || {}) as {
    mode?: 'initial_1y' | 'biweekly';
    existingUrls?: string[];
    existingTitles?: string[];
  };
  const mode = body.mode === 'biweekly' ? 'biweekly' : 'initial_1y';
  const existingUrlSet = new Set(
    Array.isArray(body.existingUrls) ? body.existingUrls.map((u) => String(u).trim()) : []
  );
  const existingTitleSet = new Set(
    Array.isArray(body.existingTitles)
      ? body.existingTitles.map((t) => normalizeText(String(t)))
      : []
  );

  const windowInfo = getDateWindow(mode);

  try {
    const ai = getGeminiClient();
    const searchPrompt = [
      `구글 학술검색(Google Scholar) 및 국내외 학술 데이터베이스에서 ${windowInfo.startYm}부터 ${windowInfo.endYm} 사이에 발표된 청소년지도학 및 청소년학 관련 최신 학술논문을 찾아주세요.`,
      `주요 키워드: 청소년지도, 청소년지도사, 청소년학연구, 한국청소년연구, 청소년복지연구, 청소년 디지털 미디어, 학교밖청소년.`,
    ].join('\n');

    const searchResponse = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: searchPrompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const groundedText = (searchResponse.text || '').trim();
    const rawChunks = searchResponse.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const uniqueChunkSources = new Map<string, string>();
    for (const chunk of rawChunks) {
      const uri = chunk.web?.uri?.trim();
      const title = chunk.web?.title?.trim() || '';
      if (uri && !uniqueChunkSources.has(uri)) {
        uniqueChunkSources.set(uri, title);
      }
    }

    const sourceEntries = Array.from(uniqueChunkSources.entries()).slice(0, 10);
    const verifiedPages = (
      await Promise.all(sourceEntries.map(([uri, title]) => resolveGroundedUrlMetadata(uri, title)))
    ).filter((p): p is GroundedPageMetadata => p !== null);

    const targetLimit = mode === 'initial_1y' ? 8 : 5;
    const synthPrompt = [
      `실제 검색 결과에 등장한 논문만 최대 ${targetLimit}편 선별하여 JSON 배열로 정리하세요.`,
      `[검색 결과]\n${groundedText.slice(0, 10000)}`,
      `[출처]\n${JSON.stringify(verifiedPages, null, 2).slice(0, 4000)}`,
    ].join('\n\n');

    const structuredResponse = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: synthPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              category: { type: Type.STRING, enum: [...LEGACY_CATEGORIES] },
              source: { type: Type.STRING },
              publishedPeriod: { type: Type.STRING },
              externalUrl: { type: Type.STRING },
              summary: { type: Type.STRING },
              keyTakeaway: { type: Type.STRING },
            },
            required: [
              'title',
              'category',
              'source',
              'publishedPeriod',
              'externalUrl',
              'summary',
              'keyTakeaway',
            ],
          },
        },
      },
    });

    const parsed = JSON.parse((structuredResponse.text ?? '[]').trim()) as Array<
      Partial<SyncedPaperPayload>
    >;
    const sanitizedPapers: SyncedPaperPayload[] = [];
    const seenTitleSet = new Set<string>();

    for (const item of parsed) {
      const title = String(item.title || '').trim().slice(0, 150);
      const normTitle = normalizeText(title);
      if (!title || title.length < 2 || seenTitleSet.has(normTitle) || existingTitleSet.has(normTitle)) {
        continue;
      }
      const category = LEGACY_CATEGORIES.includes(item.category as LegacyTrendCategory)
        ? (item.category as LegacyTrendCategory)
        : '학술논문·방법론';
      const rawPeriod = formatYearMonth(String(item.publishedPeriod || '')) || windowInfo.endYm;
      const mIdx = parseMonthIndex(rawPeriod);
      if (mIdx !== null && mIdx < windowInfo.cutoffMonthIdx) continue;

      let externalUrl = String(item.externalUrl || '').trim();
      if (
        !externalUrl ||
        !externalUrl.startsWith('http') ||
        externalUrl.includes('vertexaisearch.cloud.google.com')
      ) {
        externalUrl = `https://scholar.google.co.kr/scholar?q=${encodeURIComponent(title)}`;
      }
      externalUrl = externalUrl.slice(0, 500);
      if (existingUrlSet.has(externalUrl)) continue;

      const summary = String(item.summary || '').trim().slice(0, 5000);
      if (summary.length < 5) continue;

      seenTitleSet.add(normTitle);
      sanitizedPapers.push({
        title,
        category,
        source: String(item.source || '구글 학술검색').trim().slice(0, 100),
        publishedPeriod: rawPeriod.slice(0, 30),
        externalUrl,
        summary,
        keyTakeaway: String(item.keyTakeaway || '').trim().slice(0, 500),
      });
      if (sanitizedPapers.length >= targetLimit) break;
    }

    res.json({
      papers: sanitizedPapers,
      checkedAtIso: new Date().toISOString(),
      windowLabel: windowInfo.windowLabel,
      sourcesChecked: Math.max(verifiedPages.length, sanitizedPapers.length),
    });
  } catch (err) {
    const mapped = mapGeminiErrorMessage(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', (req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      schedule: getKstScheduleInfo(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/papers/schedule-info', (_req: Request, res: Response) => {
    res.json(getKstScheduleInfo());
  });

  app.post('/api/papers/collect', handleCollectPapers);
  app.post('/api/papers/analyze', handleAnalyzePapers);
  app.post('/api/papers/report', handleGenerateMonthlyReport);

  app.post('/api/research/sync', handleLegacyResearchSync);
  app.post('/api/kci/sync', handleLegacyResearchSync);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
