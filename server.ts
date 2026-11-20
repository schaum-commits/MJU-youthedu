import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveServerPort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const parsed = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const eqFlag = process.argv.find((arg) => arg.startsWith('--port='));
  if (eqFlag) {
    const parsed = Number(eqFlag.slice('--port='.length));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const envPort = Number(process.env.PORT || 0);
  if (Number.isFinite(envPort) && envPort > 0) {
    if (process.env.NODE_ENV !== 'production' && envPort === 8080) {
      return 3000;
    }
    return envPort;
  }
  return 3000;
}

const PORT = resolveServerPort();
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

const CORE_KOREAN_KEYWORDS = [
  '청소년지도',
  '청소년지도자',
  '청소년활동',
  '청소년수련활동',
  '청소년시설',
  '청소년정책',
  '청소년 참여',
  '청소년 역량',
  '청소년 진로',
  '청소년 리더십',
  '청소년 자치활동',
  '청소년 프로그램',
  '청소년 시민성',
  '청소년 복지',
  '학교 밖 청소년',
  '청소년 성장',
  '청소년 교육',
  '청소년 문화',
  '청소년 사회참여',
  '청소년지도 전문성',
] as const;

const EXTENDED_KOREAN_KEYWORDS = [
  'AI와 청소년',
  '디지털 청소년활동',
  '미디어 리터러시',
  '청소년 활동 효과',
  '청소년 기관 운영',
  '청소년 정책 평가',
  '청소년 활동 프로그램 개발',
  '청소년 진로개발',
  '청소년 리더십 교육',
  '청소년지도사 역량',
] as const;

const OVERSEAS_ENGLISH_KEYWORDS = [
  'Youth Work',
  'Youth Development',
  'Youth Participation',
  'Youth Leadership',
  'Youth Empowerment',
  'Career Development',
  'Youth Education',
  'Digital Citizenship',
] as const;

// 30 Korean keywords (20 core + 10 extended) grouped by the 6 YouthResearchCategory domains
const KOREAN_KEYWORD_GROUPS: Array<{
  category: YouthResearchCategory;
  keywords: string[];
  enMatchTerms: string[];
}> = [
  {
    category: '청소년지도 및 청소년 활동',
    keywords: [
      '청소년지도',
      '청소년지도자',
      '청소년활동',
      '청소년수련활동',
      '청소년시설',
      '청소년정책',
      '청소년지도 전문성',
      '청소년 기관 운영',
      '청소년 정책 평가',
      '청소년지도사 역량',
    ],
    enMatchTerms: [
      'youth work',
      'youth worker',
      'youth guidance',
      'youth facility',
      'youth center',
      'youth policy',
      'youth activity',
      'training',
      'competency',
    ],
  },
  {
    category: '청소년 진로 및 리더십',
    keywords: [
      '청소년 역량',
      '청소년 진로',
      '청소년 리더십',
      '청소년 진로개발',
      '청소년 리더십 교육',
    ],
    enMatchTerms: [
      'career',
      'leadership',
      'competency',
      'self-directed',
      'empowerment',
      'self-efficacy',
    ],
  },
  {
    category: '청소년 참여 및 사회적 성장',
    keywords: [
      '청소년 참여',
      '청소년 자치활동',
      '청소년 시민성',
      '청소년 성장',
      '청소년 사회참여',
    ],
    enMatchTerms: [
      'participation',
      'civic',
      'citizenship',
      'autonomy',
      'community',
      'human rights',
      'social growth',
    ],
  },
  {
    category: 'AI 및 디지털 시대의 청소년',
    keywords: ['AI와 청소년', '디지털 청소년활동', '미디어 리터러시'],
    enMatchTerms: [
      'ai',
      'artificial intelligence',
      'digital',
      'media',
      'smartphone',
      'online',
      'literacy',
      'cyber',
    ],
  },
  {
    category: '청소년 교육 및 평생학습',
    keywords: [
      '청소년 프로그램',
      '청소년 교육',
      '청소년 활동 효과',
      '청소년 활동 프로그램 개발',
    ],
    enMatchTerms: [
      'program',
      'education',
      'learning',
      'curriculum',
      'effectiveness',
      'experiential',
      'development',
    ],
  },
  {
    category: '청소년 문제 및 사회 변화',
    keywords: ['청소년 복지', '학교 밖 청소년', '청소년 문화'],
    enMatchTerms: [
      'welfare',
      'out-of-school',
      'dropout',
      'culture',
      'depression',
      'anxiety',
      'isolation',
      'multicultural',
      'family',
      'juvenile',
    ],
  },
];

// Domestic Korean Youth Studies Journals indexed in Crossref / OpenAlex
const KOREAN_YOUTH_JOURNALS: Array<{
  nameKo: string;
  nameEn: string;
  publisherEn: string;
  issn: string;
  doiPrefix: string;
}> = [
  {
    nameKo: '청소년학연구',
    nameEn: 'Korean Journal of Youth Studies',
    publisherEn: 'Korea Youth Research Association',
    issn: '1229-6988',
    doiPrefix: '10.21509',
  },
  {
    nameKo: '한국청소년연구',
    nameEn: 'Studies on Korean Youth',
    publisherEn: 'National Youth Policy Institute',
    issn: '1225-6366',
    doiPrefix: '10.14816',
  },
  {
    nameKo: '청소년복지연구',
    nameEn: 'Journal of Adolescent Welfare',
    publisherEn: 'Korean Association of Youth Welfare',
    issn: '1229-4705',
    doiPrefix: '10.19034',
  },
  {
    nameKo: '청소년문화포럼',
    nameEn: 'Forum For Youth Culture',
    publisherEn: 'The Research Center for Korea Youth Culture',
    issn: '1975-2733',
    doiPrefix: '10.17854',
  },
  {
    nameKo: '청소년시설환경',
    nameEn: 'Youth Facility and Environment',
    publisherEn: 'Korea Institute of Youth Facility and Environment',
    issn: '1738-0170',
    doiPrefix: '10.55063',
  },
  {
    nameKo: '미래청소년학회지',
    nameEn: 'Future Oriented Youth Society',
    publisherEn: 'Future Oriented Youth Society',
    issn: '1738-4753',
    doiPrefix: '10.34244',
  },
];

interface AcademicSourceStatus {
  id: 'nanet' | 'nl' | 'dbpia' | 'openalex' | 'crossref';
  name: string;
  scope: 'domestic' | 'international';
  envVar?: string;
  configured: boolean;
  status: 'connected' | 'ready_needs_key' | 'planned';
  stepLabel: string;
  storagePermission: 'metadata_and_link' | 'open_metadata_and_abstract' | 'search_only_link';
  aiProcessingPermission: 'abstract_or_open_fulltext_only' | 'prohibited_without_license' | 'allowed_open_abstract';
  termsSummary: string;
  endpointInfo: string;
}

interface NanetPaperPreview {
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

function buildAcademicSourcesStatus(): AcademicSourceStatus[] {
  const nanetConfigured = Boolean(process.env.NANET_API_KEY?.trim());
  const nlConfigured = Boolean(process.env.NL_API_KEY?.trim());
  const dbpiaConfigured = Boolean(process.env.DBPIA_API_KEY?.trim());
  return [
    {
      id: 'nanet',
      name: '국회도서관 국가학술정보 · 자료검색 Open API',
      scope: 'domestic',
      envVar: 'NANET_API_KEY',
      configured: nanetConfigured,
      status: nanetConfigured ? 'connected' : 'ready_needs_key',
      stepLabel: '2단계 (구현 완료)',
      storagePermission: 'metadata_and_link',
      aiProcessingPermission: 'abstract_or_open_fulltext_only',
      termsSummary:
        '공공데이터포털(data.go.kr) 활용신청 키 기반 서지 메타데이터 및 상세 링크 조회. 과도한 연속 호출 제한 준수.',
      endpointInfo:
        process.env.NANET_API_ENDPOINT?.trim() ||
        'https://apis.data.go.kr/9720000/searchservice/basic',
    },
    {
      id: 'nl',
      name: '국립중앙도서관 Open API',
      scope: 'domestic',
      envVar: 'NL_API_KEY',
      configured: nlConfigured,
      status: nlConfigured ? 'connected' : 'ready_needs_key',
      stepLabel: '3단계 (구현 완료)',
      storagePermission: 'metadata_and_link',
      aiProcessingPermission: 'abstract_or_open_fulltext_only',
      termsSummary:
        '국립중앙도서관 인증키 승인 후 학위논문·잡지/학술지·기사 서지 메타데이터 조회 및 원문 안내 연계.',
      endpointInfo:
        process.env.NL_API_ENDPOINT?.trim() ||
        'https://www.nl.go.kr/NL/search/openApi/search.do',
    },
    {
      id: 'openalex',
      name: 'OpenAlex API',
      scope: 'international',
      envVar: 'OPENALEX_API_KEY',
      configured: Boolean(process.env.OPENALEX_API_KEY?.trim()),
      status: 'connected',
      stepLabel: '4단계 (고도화 완료)',
      storagePermission: 'open_metadata_and_abstract',
      aiProcessingPermission: 'allowed_open_abstract',
      termsSummary: process.env.OPENALEX_API_KEY?.trim()
        ? 'CC0 공개 메타데이터·초록 저장 및 AI 분석 허용 (OPENALEX_API_KEY 적용됨).'
        : 'CC0 공개 메타데이터·초록 저장 및 AI 분석 허용. (무료 OPENALEX_API_KEY 미설정 시 공용 IP 할당량 429 제한이 발생할 수 있어 Crossref와 병행 동작)',
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
      termsSummary:
        '무인증키 실시간 검색·DOI 보완 허용. 국내 6대 청소년학 학술지(ISSN/DOI 접두사) 및 해외 8대 키워드 직접 수집 연동.',
      endpointInfo: 'https://api.crossref.org/works',
    },
    {
      id: 'dbpia',
      name: 'DBpia Open API (실시간 검색 · 원문 링크 전용)',
      scope: 'domestic',
      envVar: 'DBPIA_API_KEY',
      configured: dbpiaConfigured,
      status: dbpiaConfigured ? 'connected' : 'ready_needs_key',
      stepLabel: '5단계 (구현 완료)',
      storagePermission: 'search_only_link',
      aiProcessingPermission: 'prohibited_without_license',
      termsSummary:
        '약관상 대량·주기적 영구 저장, DB 축적 및 AI 학습·요약 금지(원문 미제공). 실시간 검색 결과 조회 및 DBpia 원문 랜딩 연결 전용.',
      endpointInfo:
        process.env.DBPIA_API_ENDPOINT?.trim() ||
        'https://api.dbpia.co.kr/v2/search/search.xml',
    },
  ];
}

function extractXmlTag(block: string, tagNames: string[]): string {
  for (const tag of tagNames) {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = block.match(regex);
    if (match && match[1]) {
      const cdataStripped = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
      const cleaned = stripTags(cdataStripped);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

function parseNanetXmlResponse(xmlText: string): {
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  items: NanetPaperPreview[];
} {
  const resultCode = extractXmlTag(xmlText, ['resultCode', 'RESULT_CODE', 'errCd']);
  const resultMsg = extractXmlTag(xmlText, ['resultMsg', 'RESULT_MSG', 'errMsg', 'returnAuthMsg']);
  const totalRaw = extractXmlTag(xmlText, ['total', 'totalCount', 'TOTAL_COUNT']);
  const totalCount = Number.parseInt(totalRaw || '0', 10) || 0;

  const itemBlocks = xmlText.match(/<(?:item|RECORD)\b[^>]*>[\s\S]*?<\/(?:item|RECORD)>/gi) || [];
  const items: NanetPaperPreview[] = [];

  for (const block of itemBlocks) {
    const title = extractXmlTag(block, ['title', 'TITLE', 'articleTitle', 'name']);
    if (!title) continue;
    const cn =
      extractXmlTag(block, ['cn', 'CN', 'controlNo', 'id']) ||
      makeSafePaperId('', '', title);
    const authorRaw = extractXmlTag(block, ['author', 'AUTHOR', 'researcher', 'RESEARCHER', 'writer']);
    const authors = authorRaw
      ? authorRaw
          .split(/[,;/|]/)
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 12)
      : ['저자 정보 미제공'];
    const journalName =
      extractXmlTag(block, ['publisher', 'PUBLISHER', 'journal', 'JOURNAL_NM', 'pub', 'source']) ||
      '국회도서관 등재 자료';
    const publicationDate =
      extractXmlTag(block, ['pubyear', 'PUB_DATE', 'pubDate', 'regDate', 'year']) || '';
    const materialType =
      extractXmlTag(block, ['kn', 'gubun', 'className', 'materialType']) || '학술자료';
    const detailUrl =
      extractXmlTag(block, ['detailUrl', 'DETAIL_URL', 'url', 'link']) ||
      `https://dl.nanet.go.kr/detail.do?cn=${encodeURIComponent(cn)}`;

    items.push({
      sourceId: cn,
      title: title.slice(0, 280),
      authors,
      journalName: journalName.slice(0, 180),
      publicationDate: publicationDate.slice(0, 20),
      materialType: materialType.slice(0, 60),
      paperUrl: detailUrl.slice(0, 480),
      sourceName: '국회도서관 Open API',
      country: 'KR',
      region: 'domestic',
      dataAvailability: 'metadata_only',
      storagePermission: 'metadata_and_link',
      aiProcessingPermission: 'abstract_or_open_fulltext_only',
    });
  }

  return { resultCode, resultMsg, totalCount, items };
}

function parseNanetJsonResponse(rawJson: unknown): {
  resultCode: string;
  resultMsg: string;
  totalCount: number;
  items: NanetPaperPreview[];
} {
  const root = rawJson as Record<string, unknown>;
  const response = (root?.response as Record<string, unknown>) || root;
  const header = (response?.header as Record<string, unknown>) || {};
  const body = (response?.body as Record<string, unknown>) || response;

  const resultCode = String(header.resultCode || root?.RESULT_CODE || '');
  const resultMsg = String(header.resultMsg || root?.ERROR_MESSAGE || '');
  const totalCount = Number(body?.totalCount ?? body?.total ?? root?.TOTAL_COUNT ?? 0) || 0;

  const itemsContainer = (body?.items as Record<string, unknown>) || body;
  const rawList = Array.isArray(itemsContainer?.item)
    ? itemsContainer.item
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(root?.RECORD)
        ? root.RECORD
        : itemsContainer?.item
          ? [itemsContainer.item]
          : [];

  const items: NanetPaperPreview[] = [];
  for (const row of rawList as Array<Record<string, unknown>>) {
    const title = stripTags(String(row.title || row.TITLE || row.articleTitle || ''));
    if (!title) continue;
    const cn = String(row.cn || row.CN || row.controlNo || makeSafePaperId('', '', title));
    const authorStr = stripTags(String(row.author || row.AUTHOR || row.RESEARCHER || ''));
    const authors = authorStr
      ? authorStr
          .split(/[,;/|]/)
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 12)
      : ['저자 정보 미제공'];
    const journalName =
      stripTags(String(row.publisher || row.PUBLISHER || row.journal || row.JOURNAL_NM || '')) ||
      '국회도서관 등재 자료';
    const publicationDate = String(row.pubyear || row.PUB_DATE || row.pubDate || '').slice(0, 20);
    const materialType = String(row.kn || row.gubun || row.className || '학술자료').slice(0, 60);
    const detailUrl =
      String(row.detailUrl || row.DETAIL_URL || row.url || '').trim() ||
      `https://dl.nanet.go.kr/detail.do?cn=${encodeURIComponent(cn)}`;

    items.push({
      sourceId: cn,
      title: title.slice(0, 280),
      authors,
      journalName: journalName.slice(0, 180),
      publicationDate,
      materialType,
      paperUrl: detailUrl.slice(0, 480),
      sourceName: '국회도서관 Open API',
      country: 'KR',
      region: 'domestic',
      dataAvailability: 'metadata_only',
      storagePermission: 'metadata_and_link',
      aiProcessingPermission: 'abstract_or_open_fulltext_only',
    });
  }

  return { resultCode, resultMsg, totalCount, items };
}

async function searchNanetOpenApi(params: {
  query: string;
  pageNo?: number;
  displayLines?: number;
}) {
  const apiKey = process.env.NANET_API_KEY?.trim();
  const endpoint =
    process.env.NANET_API_ENDPOINT?.trim() ||
    'https://apis.data.go.kr/9720000/searchservice/basic';
  const cleanQuery = params.query.trim() || '청소년지도';
  const pageNo = Math.max(1, Number(params.pageNo || 1));
  const displayLines = Math.min(Math.max(1, Number(params.displayLines || 10)), 30);

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      status: 'ready_needs_key' as const,
      source: 'nanet',
      query: cleanQuery,
      endpoint,
      totalCount: 0,
      papers: [] as NanetPaperPreview[],
      message:
        '국회도서관 Open API 인증키(NANET_API_KEY)가 아직 설정되지 않아 연결 준비 상태입니다. 공공데이터포털(data.go.kr)에서 활용신청 후 AI Studio Settings > Secrets에 NANET_API_KEY를 등록하면 즉시 실데이터 검색이 동작합니다.',
    };
  }

  const encodedServiceKey = /%[0-9A-Fa-f]{2}/.test(apiKey)
    ? apiKey
    : encodeURIComponent(apiKey);
  const searchTerm = cleanQuery.includes(',') ? cleanQuery : `자료명,${cleanQuery}`;
  const requestUrl =
    `${endpoint}?serviceKey=${encodedServiceKey}` +
    `&pageno=${pageNo}` +
    `&displaylines=${displayLines}` +
    `&search=${encodeURIComponent(searchTerm)}`;

  const res = await fetch(requestUrl, {
    headers: {
      Accept: 'application/json, application/xml, text/xml;q=0.9, */*;q=0.8',
      'User-Agent': POLITE_USER_AGENT,
    },
    signal: AbortSignal.timeout(12000),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      configured: true,
      status: 'api_error' as const,
      source: 'nanet',
      query: cleanQuery,
      endpoint,
      totalCount: 0,
      papers: [] as NanetPaperPreview[],
      message: `국회도서관 Open API 응답 오류 (HTTP ${res.status}): ${rawBody.slice(0, 180)}`,
    };
  }

  const trimmed = rawBody.trim();
  const parsed = trimmed.startsWith('{')
    ? parseNanetJsonResponse(JSON.parse(trimmed))
    : parseNanetXmlResponse(trimmed);

  if (parsed.resultCode && !['0', '00', 'SUCCESS', 'INFO-000'].includes(parsed.resultCode.toUpperCase())) {
    return {
      ok: false,
      configured: true,
      status: 'api_error' as const,
      source: 'nanet',
      query: cleanQuery,
      endpoint,
      totalCount: 0,
      papers: [] as NanetPaperPreview[],
      message: `국회도서관 Open API 오류 (${parsed.resultCode}): ${parsed.resultMsg || '인증키 또는 요청 파라미터를 확인해 주세요.'}`,
    };
  }

  return {
    ok: true,
    configured: true,
    status: 'connected' as const,
    source: 'nanet',
    query: cleanQuery,
    endpoint,
    totalCount: parsed.totalCount,
    papers: parsed.items,
    message: `국회도서관 Open API에서 "${cleanQuery}" 검색 결과 ${parsed.items.length}건(전체 ${parsed.totalCount}건)을 조회했습니다.`,
  };
}

interface NlPaperPreview {
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

function parseNlJsonResponse(rawJson: unknown): {
  errorMsg: string;
  totalCount: number;
  items: NlPaperPreview[];
} {
  const root = (rawJson || {}) as Record<string, unknown>;
  const errorMsg = String(root.error_msg || root.errMsg || root.message || '');
  const totalCount = Number(root.total ?? root.totalCount ?? 0) || 0;
  const rawList = Array.isArray(root.result)
    ? root.result
    : Array.isArray(root.items)
      ? root.items
      : [];

  const items: NlPaperPreview[] = [];
  for (const row of rawList as Array<Record<string, unknown>>) {
    const title = stripTags(String(row.title_info || row.title || ''));
    if (!title) continue;
    const controlNo = String(row.control_no || row.id || makeSafePaperId('', '', title));
    const authorStr = stripTags(String(row.author_info || row.author || ''));
    const authors = authorStr
      ? authorStr
          .split(/[,;/|]/)
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 12)
      : ['저자 정보 미제공'];
    const journalName =
      stripTags(String(row.pub_info || row.publisher || '')) || '국립중앙도서관 소장 자료';
    const publicationDate = stripTags(String(row.pub_year_info || row.pub_year || '')).slice(0, 20);
    const materialType =
      stripTags(String(row.type_name || row.category || row.manage_name || '학술자료')).slice(0, 60);
    const rawDetail = String(row.detail_link || row.url || '').trim();
    const detailUrl = rawDetail.startsWith('http')
      ? rawDetail
      : rawDetail.startsWith('/')
        ? `https://www.nl.go.kr${rawDetail}`
        : `https://www.nl.go.kr/NL/contents/search.do?srchTarget=total&pageNum=1&pageSize=10&kwd=${encodeURIComponent(title)}`;

    items.push({
      sourceId: controlNo,
      title: title.slice(0, 280),
      authors,
      journalName: journalName.slice(0, 180),
      publicationDate,
      materialType,
      paperUrl: detailUrl.slice(0, 480),
      sourceName: '국립중앙도서관 Open API',
      country: 'KR',
      region: 'domestic',
      dataAvailability: 'metadata_only',
      storagePermission: 'metadata_and_link',
      aiProcessingPermission: 'abstract_or_open_fulltext_only',
    });
  }

  return { errorMsg, totalCount, items };
}

function parseNlXmlResponse(xmlText: string): {
  errorMsg: string;
  totalCount: number;
  items: NlPaperPreview[];
} {
  const errorMsg = extractXmlTag(xmlText, ['error_msg', 'errMsg', 'resultMsg']);
  const totalRaw = extractXmlTag(xmlText, ['total', 'totalCount']);
  const totalCount = Number.parseInt(totalRaw || '0', 10) || 0;
  const itemBlocks = xmlText.match(/<(?:item|result)\b[^>]*>[\s\S]*?<\/(?:item|result)>/gi) || [];
  const items: NlPaperPreview[] = [];

  for (const block of itemBlocks) {
    const title = extractXmlTag(block, ['title_info', 'title']);
    if (!title) continue;
    const controlNo =
      extractXmlTag(block, ['control_no', 'id']) || makeSafePaperId('', '', title);
    const authorStr = extractXmlTag(block, ['author_info', 'author']);
    const authors = authorStr
      ? authorStr
          .split(/[,;/|]/)
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 12)
      : ['저자 정보 미제공'];
    const journalName =
      extractXmlTag(block, ['pub_info', 'publisher']) || '국립중앙도서관 소장 자료';
    const publicationDate = extractXmlTag(block, ['pub_year_info', 'pub_year']).slice(0, 20);
    const materialType =
      extractXmlTag(block, ['type_name', 'category', 'manage_name']) || '학술자료';
    const rawDetail = extractXmlTag(block, ['detail_link', 'url']);
    const detailUrl = rawDetail.startsWith('http')
      ? rawDetail
      : rawDetail.startsWith('/')
        ? `https://www.nl.go.kr${rawDetail}`
        : `https://www.nl.go.kr/NL/contents/search.do?srchTarget=total&pageNum=1&pageSize=10&kwd=${encodeURIComponent(title)}`;

    items.push({
      sourceId: controlNo,
      title: title.slice(0, 280),
      authors,
      journalName: journalName.slice(0, 180),
      publicationDate,
      materialType: materialType.slice(0, 60),
      paperUrl: detailUrl.slice(0, 480),
      sourceName: '국립중앙도서관 Open API',
      country: 'KR',
      region: 'domestic',
      dataAvailability: 'metadata_only',
      storagePermission: 'metadata_and_link',
      aiProcessingPermission: 'abstract_or_open_fulltext_only',
    });
  }

  return { errorMsg, totalCount, items };
}

async function searchNlOpenApi(params: {
  query: string;
  category?: string;
  pageNo?: number;
  pageSize?: number;
}) {
  const apiKey = process.env.NL_API_KEY?.trim();
  const endpoint =
    process.env.NL_API_ENDPOINT?.trim() ||
    'https://www.nl.go.kr/NL/search/openApi/search.do';
  const cleanQuery = params.query.trim() || '청소년지도';
  const cleanCategory = (params.category || '').trim();
  const pageNo = Math.max(1, Number(params.pageNo || 1));
  const pageSize = Math.min(Math.max(1, Number(params.pageSize || 10)), 30);

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      status: 'ready_needs_key' as const,
      source: 'nl',
      query: cleanQuery,
      category: cleanCategory || '전체',
      endpoint,
      totalCount: 0,
      papers: [] as NlPaperPreview[],
      message:
        '국립중앙도서관 Open API 인증키(NL_API_KEY)가 아직 설정되지 않아 연결 준비 상태입니다. 국립중앙도서관(nl.go.kr) Open API 인증키 신청·승인 후 AI Studio Settings > Secrets에 NL_API_KEY를 등록하면 즉시 실데이터 검색이 동작합니다.',
    };
  }

  const url = new URL(endpoint);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('apiType', 'json');
  url.searchParams.set('pageNum', String(pageNo));
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('kwd', cleanQuery);
  if (cleanCategory && cleanCategory !== '전체') {
    url.searchParams.set('category', cleanCategory);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json, application/xml, text/xml;q=0.9, */*;q=0.8',
      'User-Agent': POLITE_USER_AGENT,
    },
    signal: AbortSignal.timeout(12000),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      configured: true,
      status: 'api_error' as const,
      source: 'nl',
      query: cleanQuery,
      category: cleanCategory || '전체',
      endpoint,
      totalCount: 0,
      papers: [] as NlPaperPreview[],
      message: `국립중앙도서관 Open API 응답 오류 (HTTP ${res.status}): ${rawBody.slice(0, 180)}`,
    };
  }

  const trimmed = rawBody.trim();
  const parsed = trimmed.startsWith('{')
    ? parseNlJsonResponse(JSON.parse(trimmed))
    : parseNlXmlResponse(trimmed);

  if (parsed.errorMsg) {
    return {
      ok: false,
      configured: true,
      status: 'api_error' as const,
      source: 'nl',
      query: cleanQuery,
      category: cleanCategory || '전체',
      endpoint,
      totalCount: 0,
      papers: [] as NlPaperPreview[],
      message: `국립중앙도서관 Open API 오류: ${parsed.errorMsg}`,
    };
  }

  return {
    ok: true,
    configured: true,
    status: 'connected' as const,
    source: 'nl',
    query: cleanQuery,
    category: cleanCategory || '전체',
    endpoint,
    totalCount: parsed.totalCount,
    papers: parsed.items,
    message: `국립중앙도서관 Open API에서 "${cleanQuery}"${cleanCategory && cleanCategory !== '전체' ? ` (${cleanCategory})` : ''} 검색 결과 ${parsed.items.length}건(전체 ${parsed.totalCount}건)을 조회했습니다.`,
  };
}

interface DbpiaPaperPreview {
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

function cleanDbpiaText(raw: string): string {
  return decodeHtmlEntities(
    raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<!HS>|<!HE>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDbpiaYymm(yymmRaw: string): string {
  const digits = yymmRaw.replace(/\D/g, '');
  if (digits.length >= 6) {
    return `${digits.slice(0, 4)}.${digits.slice(4, 6)}`;
  }
  if (digits.length === 4) {
    return digits;
  }
  return yymmRaw.trim();
}

function parseDbpiaXmlResponse(xmlText: string): {
  errorCode: string;
  errorMsg: string;
  totalCount: number;
  items: DbpiaPaperPreview[];
} {
  const errorCode = extractXmlTag(xmlText, ['Code', 'errorCode', 'errCd']);
  const errorMsg = extractXmlTag(xmlText, ['Message', 'errorMsg', 'errMsg']);
  const totalRaw = extractXmlTag(xmlText, ['totalcount', 'totalCount', 'total']);
  const totalCount = Number.parseInt(totalRaw || '0', 10) || 0;

  const itemBlocks = xmlText.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || [];
  const items: DbpiaPaperPreview[] = [];

  for (const block of itemBlocks) {
    // Title is top-level inside <item>; extract before nested blocks if possible
    const titleMatch = block.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = cleanDbpiaText(titleMatch?.[1] || '');
    if (!title) continue;

    // Extract authors from <authors><author><name>...</name></author></authors>
    const authorsBlock = block.match(/<authors\b[^>]*>([\s\S]*?)<\/authors>/i)?.[1] || '';
    const authorMatches = Array.from(authorsBlock.matchAll(/<name\b[^>]*>([\s\S]*?)<\/name>/gi))
      .map((m) => cleanDbpiaText(m[1] || ''))
      .filter(Boolean);
    const authors =
      authorMatches.length > 0 ? authorMatches.slice(0, 12) : ['저자 정보 미제공'];

    // Extract journal name from <publication><name>...</name></publication>
    const pubBlock = block.match(/<publication\b[^>]*>([\s\S]*?)<\/publication>/i)?.[1] || '';
    const journalName =
      cleanDbpiaText(pubBlock.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1] || '') ||
      'DBpia 수록 학술지';

    // Extract publisher/society from <publisher><name>...</name></publisher>
    const publisherBlock = block.match(/<publisher\b[^>]*>([\s\S]*?)<\/publisher>/i)?.[1] || '';
    const publisherName = cleanDbpiaText(
      publisherBlock.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1] || ''
    );

    // Extract issue <yymm>
    const issueBlock = block.match(/<issue\b[^>]*>([\s\S]*?)<\/issue>/i)?.[1] || '';
    const yymmRaw = cleanDbpiaText(
      issueBlock.match(/<yymm\b[^>]*>([\s\S]*?)<\/yymm>/i)?.[1] || ''
    );
    const publicationDate = formatDbpiaYymm(yymmRaw).slice(0, 20);

    const pages = cleanDbpiaText(block.match(/<pages\b[^>]*>([\s\S]*?)<\/pages>/i)?.[1] || '');
    const freeRaw = cleanDbpiaText(
      block.match(/<free_yn\b[^>]*>([\s\S]*?)<\/free_yn>/i)?.[1] || ''
    ).toUpperCase();
    const freeYn: 'Y' | 'N' = freeRaw === 'Y' ? 'Y' : 'N';

    const linkUrlRaw = cleanDbpiaText(
      block.match(/<link_url\b[^>]*>([\s\S]*?)<\/link_url>/i)?.[1] || ''
    );
    const nodeIdMatch = linkUrlRaw.match(/nodeId=([A-Za-z0-9_-]+)/i);
    const sourceId = nodeIdMatch?.[1] || makeSafePaperId('', linkUrlRaw, title);
    const paperUrl = linkUrlRaw.startsWith('http')
      ? linkUrlRaw
      : `https://www.dbpia.co.kr/search/topSearch?searchOption=all&query=${encodeURIComponent(title)}`;

    items.push({
      sourceId,
      title: title.slice(0, 280),
      authors,
      journalName: journalName.slice(0, 180),
      publisherName: publisherName.slice(0, 140),
      publicationDate,
      pages: pages.slice(0, 40),
      freeYn,
      paperUrl: paperUrl.slice(0, 480),
      sourceName: 'DBpia Open API (실시간 조회 · 미저장)',
      country: 'KR',
      region: 'domestic',
      dataAvailability: 'metadata_and_link_only',
      storagePermission: 'search_only_link',
      aiProcessingPermission: 'prohibited_without_license',
    });
  }

  return { errorCode, errorMsg, totalCount, items };
}

async function searchDbpiaOpenApi(params: {
  query: string;
  sortType?: '1' | '2';
  pageNo?: number;
  pageCount?: number;
}) {
  const apiKey = process.env.DBPIA_API_KEY?.trim();
  const endpoint =
    process.env.DBPIA_API_ENDPOINT?.trim() || 'https://api.dbpia.co.kr/v2/search/search.xml';
  const cleanQuery = params.query.trim() || '청소년지도';
  const sortType = params.sortType === '1' ? '1' : '2'; // 2: 최신 발행순, 1: 정확도순
  const pageNo = Math.max(1, Number(params.pageNo || 1));
  const pageCount = Math.min(Math.max(1, Number(params.pageCount || 10)), 30);

  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      status: 'ready_needs_key' as const,
      source: 'dbpia',
      query: cleanQuery,
      sortType,
      endpoint,
      totalCount: 0,
      papers: [] as DbpiaPaperPreview[],
      message:
        'DBpia Open API 인증키(DBPIA_API_KEY)가 아직 설정되지 않아 연결 준비 상태입니다. DBpia API 이용 신청·승인 후 AI Studio Settings > Secrets에 DBPIA_API_KEY를 등록하면 실시간 검색 및 원문 링크 연결이 동작합니다. (약관 준수: 검색 결과 미저장)',
    };
  }

  const url = new URL(endpoint);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('target', 'se');
  url.searchParams.set('searchall', cleanQuery);
  url.searchParams.set('pagenumber', String(pageNo));
  url.searchParams.set('pagecount', String(pageCount));
  url.searchParams.set('sorttype', sortType);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
      'User-Agent': POLITE_USER_AGENT,
    },
    signal: AbortSignal.timeout(12000),
  });

  const rawBody = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      configured: true,
      status: 'api_error' as const,
      source: 'dbpia',
      query: cleanQuery,
      sortType,
      endpoint,
      totalCount: 0,
      papers: [] as DbpiaPaperPreview[],
      message: `DBpia Open API 응답 오류 (HTTP ${res.status}): ${rawBody.slice(0, 180)}`,
    };
  }

  const parsed = parseDbpiaXmlResponse(rawBody);
  if (parsed.errorCode || parsed.errorMsg) {
    return {
      ok: false,
      configured: true,
      status: 'api_error' as const,
      source: 'dbpia',
      query: cleanQuery,
      sortType,
      endpoint,
      totalCount: 0,
      papers: [] as DbpiaPaperPreview[],
      message: `DBpia Open API 오류 (${parsed.errorCode || 'ERR'}): ${parsed.errorMsg || '인증키 또는 요청 파라미터를 확인해 주세요.'}`,
    };
  }

  return {
    ok: true,
    configured: true,
    status: 'connected' as const,
    source: 'dbpia',
    query: cleanQuery,
    sortType,
    endpoint,
    totalCount: parsed.totalCount,
    papers: parsed.items,
    message: `DBpia Open API 실시간 검색("${cleanQuery}") 결과 ${parsed.items.length}건(전체 ${parsed.totalCount}건)을 조회했습니다. (약관 준수: 영구 저장 및 AI 요약 미수행)`,
  };
}

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

function classifyPaperRegion(params: {
  language?: string;
  title?: string;
  journalName?: string;
  publisher?: string;
  abstract?: string;
  doi?: string;
  issns?: string[];
  countryCodes?: string[];
  institutions?: string[];
}): { region: 'domestic' | 'international'; country: string; reason: string } {
  const titleStr = params.title || '';
  const journalStr = params.journalName || '';
  const publisherStr = params.publisher || '';
  const abstractStr = params.abstract || '';
  const instStr = (params.institutions || []).join(' ');
  const doiLower = normalizeDoi(params.doi);
  const issnSet = new Set((params.issns || []).map((s) => s.trim().toUpperCase()));

  // 1. Known Korean Youth Studies Journal registry (ISSN / DOI prefix / Journal & Publisher name)
  const matchedKoreanJournal = KOREAN_YOUTH_JOURNALS.find((j) => {
    if (doiLower && doiLower.startsWith(`${j.doiPrefix.toLowerCase()}/`)) return true;
    if (j.issn && issnSet.has(j.issn.toUpperCase())) return true;
    const jl = journalStr.toLowerCase();
    const pl = publisherStr.toLowerCase();
    return (
      jl.includes(j.nameKo) ||
      jl.includes(j.nameEn.toLowerCase()) ||
      (j.publisherEn && pl.includes(j.publisherEn.toLowerCase()))
    );
  });
  if (matchedKoreanJournal) {
    return {
      region: 'domestic',
      country: 'KR',
      reason: `국내 학술지/발행기관 확인 (${matchedKoreanJournal.nameKo})`,
    };
  }

  // 2. Journal or Publisher or Institution country code === KR
  if (params.countryCodes?.some((c) => c.toUpperCase() === 'KR')) {
    return {
      region: 'domestic',
      country: 'KR',
      reason: '발행기관/소속기관 국가코드(KR) 확인',
    };
  }

  // 3. Publisher / Journal / Institution name signals (non-language)
  const combinedOrgText = `${journalStr} ${publisherStr} ${instStr}`.toLowerCase();
  const koreanOrgMarkers = [
    'korean',
    'korea',
    'south korea',
    'seoul',
    'myongji',
    'yonsei',
    'sungkyunkwan',
    'chung-ang',
    'kyung hee',
    'ewha',
    'pusan',
    'kyungpook',
    'chonnam',
    'hanyang',
    'kci',
    'dbpia',
    'riss',
    'kiss',
    'nyci',
    'kywa',
    '한국',
    '대한',
    '청소년',
    '명지',
    '대학교',
    '학회',
    '연구원',
  ];
  const matchedMarker = koreanOrgMarkers.find((m) => combinedOrgText.includes(m));
  if (matchedMarker) {
    return {
      region: 'domestic',
      country: 'KR',
      reason: `학술지·발행기관명 국내 신호(${matchedMarker}) 확인`,
    };
  }

  // 4. Language or Hangul content combined with context
  const hasHangul = /[가-힣]/.test(`${titleStr} ${journalStr} ${publisherStr} ${abstractStr}`);
  if (params.language === 'ko' || hasHangul) {
    return {
      region: 'domestic',
      country: 'KR',
      reason: '한국어 논문 및 한글 서지정보 확인',
    };
  }

  const firstCountry = params.countryCodes?.find((c) => Boolean(c && c.trim()));
  return {
    region: 'international',
    country: firstCountry ? firstCountry.toUpperCase() : 'INTL',
    reason: '해외 학술지 및 영문/해외 발행기관 기준 판정',
  };
}

function getDateRangeByMonths(months: number) {
  const safeMonths = Math.min(Math.max(Math.round(months || 12), 1), 60);
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const from = new Date(now);
  from.setMonth(from.getMonth() - safeMonths);
  const fromDate = from.toISOString().slice(0, 10);
  return { fromDate, toDate, lookbackMonths: safeMonths };
}

function getKstScheduleInfo(nowInput: Date = new Date()) {
  const now = Number.isNaN(nowInput.getTime()) ? new Date() : nowInput;
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
  const hour = Number(getPart('hour')) % 24;

  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;
  const currentMonthLabel = `${year}년 ${String(month).padStart(2, '0')}월`;
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
  const nextRunKstIso = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T03:00:00+09:00`;
  const nextRunKstLabel = `${nextYear}.${String(nextMonth).padStart(2, '0')}.01 03:00 (Asia/Seoul)`;

  return {
    cron: '0 3 1 * *',
    timezone: 'Asia/Seoul',
    currentMonthKey,
    currentMonthLabel,
    kstNowLabel: `${year}.${String(month).padStart(2, '0')}.${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${getPart('minute')} KST`,
    isPastScheduledSlotThisMonth,
    currentMonthSlotLabel,
    nextRunKstIso,
    nextRunKstLabel,
  };
}

function evaluateServerMonthlySchedule({
  nowInput = new Date(),
  lastSyncedAtIso,
  scheduleCron = '0 3 1 * *',
  autoEnabled = true,
  papersCount = 0,
}: {
  nowInput?: Date;
  lastSyncedAtIso?: string | null;
  scheduleCron?: string;
  autoEnabled?: boolean;
  papersCount?: number;
}) {
  const schedule = getKstScheduleInfo(nowInput);
  if (!autoEnabled) {
    return { due: false, reason: '자동 스케줄이 일시 중지되어 있습니다.', schedule };
  }
  if (papersCount <= 0) {
    return {
      due: true,
      reason: '수집된 논문이 없어 초기 자동 수집 대상입니다.',
      schedule,
    };
  }
  if (!lastSyncedAtIso || scheduleCron !== '0 3 1 * *') {
    return {
      due: true,
      reason: '매월 1일 KST 03:00 기준 정기 실행 이력이 없어 자동 수집 대상입니다.',
      schedule,
    };
  }
  const lastDate = new Date(lastSyncedAtIso);
  if (Number.isNaN(lastDate.getTime())) {
    return {
      due: true,
      reason: '마지막 실행 시각 형식을 확인할 수 없어 자동 수집 대상입니다.',
      schedule,
    };
  }
  if (!schedule.isPastScheduledSlotThisMonth) {
    return {
      due: false,
      reason: `이번 달 정기 시각(${schedule.currentMonthSlotLabel}) 도래 전입니다.`,
      schedule,
    };
  }
  const lastInfo = getKstScheduleInfo(lastDate);
  if (lastInfo.currentMonthKey < schedule.currentMonthKey) {
    return {
      due: true,
      reason: `이번 달 정기 시각(${schedule.currentMonthSlotLabel}) 이후 미실행 상태이므로 자동 실행됩니다.`,
      schedule,
    };
  }
  return {
    due: false,
    reason: `${schedule.currentMonthLabel} 정기 수집이 이미 완료되었습니다 (${lastInfo.kstNowLabel}).`,
    schedule,
  };
}

function mapGeminiErrorMessage(err: unknown): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw === 'GEMINI_API_KEY_MISSING') {
    return {
      status: 500,
      message:
        'GEMINI_API_KEY가 설정되지 않았습니다. Cloud Run 환경변수(Secret Manager) 또는 Settings > Secrets에 Gemini API 키를 등록해 주세요.',
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
        'Gemini API 키가 유효하지 않거나 권한이 없습니다. Cloud Run 환경변수(Secret Manager) 또는 Secrets의 API 키 상태를 확인해 주세요.',
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
    source?: {
      display_name?: string | null;
      country_code?: string | null;
      host_organization_name?: string | null;
      issn?: string[] | null;
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
    mailto: 'schaum@mju.ac.kr',
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
    const errBody = await res.text().catch(() => '');
    if (res.status === 429 && errBody.includes('daily_budget')) {
      throw new Error('OPENALEX_DAILY_BUDGET_429');
    }
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
  publisher?: string;
  ISSN?: string[];
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
  subject?: string[];
  'is-referenced-by-count'?: number;
}

function formatCrossrefDate(item: CrossrefWorkItem): string {
  const parts =
    item.published?.['date-parts']?.[0] ||
    item['published-online']?.['date-parts']?.[0] ||
    item['published-print']?.['date-parts']?.[0];
  if (!parts || parts.length === 0 || !parts[0]) return '';
  const y = Number(parts[0]);
  const maxYear = new Date().getFullYear() + 1;
  if (!Number.isFinite(y) || y < 1950 || y > maxYear) return '';
  const m = parts[1] ? String(parts[1]).padStart(2, '0') : '01';
  const d = parts[2] ? String(parts[2]).padStart(2, '0') : '01';
  return `${y}-${m}-${d}`;
}

async function fetchCrossrefByDoi(doi: string): Promise<CrossrefWorkItem | null> {
  const cleanDoi = normalizeDoi(doi);
  if (!cleanDoi) return null;
  try {
    const res = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(cleanDoi)}?mailto=schaum@mju.ac.kr`,
      {
        headers: { 'User-Agent': POLITE_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      }
    );
    if (!res.ok) return null;
    const text = await res.text();
    const json = JSON.parse(text) as { message?: CrossrefWorkItem };
    return json.message || null;
  } catch {
    return null;
  }
}

async function fetchCrossrefWorksByUrl(url: string, retries = 1): Promise<CrossrefWorkItem[]> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': POLITE_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          await new Promise((r) => setTimeout(r, 650));
          continue;
        }
        return [];
      }
      const text = await res.text();
      if (!text.trim().startsWith('{')) return [];
      const json = JSON.parse(text) as { message?: { items?: CrossrefWorkItem[] } };
      return Array.isArray(json.message?.items) ? json.message!.items! : [];
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 650));
        continue;
      }
      return [];
    }
  }
  return [];
}

async function runInBatches<T, R>(
  tasks: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const slice = tasks.slice(i, i + concurrency);
    const batchOut = await Promise.all(slice.map((item) => worker(item)));
    results.push(...batchOut);
  }
  return results;
}

function inferYouthCategoryFromText(text: string): YouthResearchCategory {
  const lower = text.toLowerCase();
  let bestCategory: YouthResearchCategory = '청소년지도 및 청소년 활동';
  let bestScore = 0;

  for (const grp of KOREAN_KEYWORD_GROUPS) {
    let score = 0;
    for (const kw of grp.keywords) {
      if (lower.includes(kw.toLowerCase())) score += 3;
    }
    for (const en of grp.enMatchTerms) {
      if (lower.includes(en.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = grp.category;
    }
  }
  return bestCategory;
}

function isYouthRelevantText(text: string): boolean {
  const lower = text.toLowerCase();
  const youthMarkers = [
    'youth',
    'adolescent',
    'teen',
    'juvenile',
    'young people',
    'emerging adult',
    'student',
    'career development',
    'digital citizenship',
    '청소년',
    '청년',
    '아동',
    '학생',
  ];
  return youthMarkers.some((m) => lower.includes(m));
}

function normalizeCrossrefCandidate(
  crItem: CrossrefWorkItem,
  hintCategory?: YouthResearchCategory,
  fallbackDate?: string
): CollectedPaperDraft | null {
  const title = stripTags(String(crItem.title?.[0] || '')).slice(0, 300);
  if (!title || title.length < 3) return null;

  const doiClean = normalizeDoi(crItem.DOI);
  const authors = (crItem.author || [])
    .map((a) => a.name || [a.family, a.given].filter(Boolean).join(' ').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (authors.length === 0) authors.push('저자 정보 확인 중');

  const journalName = stripTags(String(crItem['container-title']?.[0] || crItem.publisher || '학술지 미상')).slice(
    0,
    200
  );
  const publisher = stripTags(String(crItem.publisher || ''));
  const publicationDate = (formatCrossrefDate(crItem) || fallbackDate || new Date().toISOString().slice(0, 10)).slice(
    0,
    20
  );
  const abstract = crItem.abstract ? stripTags(crItem.abstract).slice(0, 8000) : '';
  const language = (crItem.language || (/[가-힣]/.test(title) ? 'ko' : 'en')).slice(0, 20);
  const affiliations = (crItem.author || [])
    .flatMap((a) => (a.affiliation || []).map((af) => af.name || ''))
    .filter(Boolean);

  const regionInfo = classifyPaperRegion({
    language,
    title,
    journalName,
    publisher,
    abstract,
    doi: doiClean,
    issns: crItem.ISSN || [],
    institutions: affiliations,
  });

  const resolvedHint =
    hintCategory || inferYouthCategoryFromText(`${title} ${abstract} ${journalName}`);

  const keywords = Array.from(
    new Set(
      (crItem.subject || [])
        .map((s) => stripTags(s))
        .filter(Boolean)
    )
  ).slice(0, 12);

  const paperUrl = (crItem.URL || (doiClean ? `https://doi.org/${doiClean}` : '')).slice(0, 500);

  return {
    paperId: makeSafePaperId('', doiClean, title),
    title,
    authors,
    journalName,
    publicationDate,
    language,
    region: regionInfo.region,
    abstract,
    keywords,
    doi: doiClean.slice(0, 200),
    openAlexId: '',
    crossrefId: doiClean.slice(0, 200),
    paperUrl,
    source: 'Crossref',
    openAccess: false,
    citedByCount: Number(crItem['is-referenced-by-count'] || 0),
    hintCategory: resolvedHint,
  };
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
  const maxFreshLimit = lookbackMonths >= 36 ? 24 : 16;

  let openAlexCalls = 0;
  let crossrefCalls = 0;
  const collectionErrors: string[] = [];

  const oaCandidateMap = new Map<string, { work: OpenAlexWork; hintCategory: YouthResearchCategory }>();
  const crDirectCandidates: Array<{ item: CrossrefWorkItem; hintCategory: YouthResearchCategory }> = [];

  // 1. OpenAlex queries: 6 category English queries + all 30 Korean keywords (grouped by 6 categories)
  let openAlexBudgetExhausted = false;
  let consecutiveOpenAlexErrors = 0;
  for (let idx = 0; idx < CATEGORY_QUERIES.length; idx += 1) {
    if (openAlexBudgetExhausted) break;
    const cfg = CATEGORY_QUERIES[idx];
    const koGroup = KOREAN_KEYWORD_GROUPS[idx];
    const fullKoQuery = koGroup ? koGroup.keywords.join('|') : cfg.koQuery;

    try {
      openAlexCalls += 1;
      const koResults = await fetchOpenAlexWorks({
        filter: `from_publication_date:${fromDate},to_publication_date:${toDate},default.search:${fullKoQuery}`,
        page: 1,
        perPage: Math.min(perCategoryLimit + 2, 6),
      });
      consecutiveOpenAlexErrors = 0;
      for (const work of koResults) {
        if (work.id && !oaCandidateMap.has(work.id)) {
          oaCandidateMap.set(work.id, { work, hintCategory: cfg.category });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      consecutiveOpenAlexErrors += 1;
      if (msg === 'OPENALEX_DAILY_BUDGET_429' || (msg.includes('503') && consecutiveOpenAlexErrors >= 2)) {
        openAlexBudgetExhausted = true;
        collectionErrors.push(
          msg === 'OPENALEX_DAILY_BUDGET_429'
            ? 'OpenAlex 공용 IP 일일 할당량(429) 도달 — OPENALEX_API_KEY 설정 시 해소되며, Crossref 국내외 직접 수집으로 자동 보완합니다.'
            : 'OpenAlex 서버 일시 장애(503) 감지 — Crossref 국내외 직접 수집으로 자동 전환합니다.'
        );
        break;
      }
      collectionErrors.push(`OpenAlex 국문(30개 확장어) 오류(${cfg.category}): ${msg}`);
    }

    if (openAlexBudgetExhausted) break;

    try {
      openAlexCalls += 1;
      const enResults = await fetchOpenAlexWorks({
        filter: `from_publication_date:${fromDate},to_publication_date:${toDate},title_and_abstract.search:${cfg.enQuery}`,
        page: 1,
        perPage: Math.min(perCategoryLimit + 1, 5),
      });
      consecutiveOpenAlexErrors = 0;
      for (const work of enResults) {
        if (work.id && !oaCandidateMap.has(work.id)) {
          oaCandidateMap.set(work.id, { work, hintCategory: cfg.category });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      consecutiveOpenAlexErrors += 1;
      if (msg === 'OPENALEX_DAILY_BUDGET_429' || (msg.includes('503') && consecutiveOpenAlexErrors >= 2)) {
        openAlexBudgetExhausted = true;
        collectionErrors.push(
          msg === 'OPENALEX_DAILY_BUDGET_429'
            ? 'OpenAlex 공용 IP 일일 할당량(429) 도달 — Crossref REST API로 자동 전환 수집합니다.'
            : 'OpenAlex 서버 일시 장애(503) 감지 — Crossref REST API로 자동 전환 수집합니다.'
        );
        break;
      }
      collectionErrors.push(`OpenAlex 영문 수집 오류(${cfg.category}): ${msg}`);
    }
  }

  // 2. Crossref direct domestic Korean Youth Studies Journals (6 KCI journals indexed in Crossref)
  const journalRows = lookbackMonths >= 36 ? 8 : 5;
  const crJournalResults = await runInBatches(KOREAN_YOUTH_JOURNALS, 3, async (j) => {
    crossrefCalls += 1;
    const url =
      `https://api.crossref.org/prefixes/${j.doiPrefix}/works` +
      `?filter=${encodeURIComponent(`from-pub-date:${fromDate},until-pub-date:${toDate}`)}` +
      `&sort=published&order=desc&rows=${journalRows}&mailto=schaum@mju.ac.kr`;
    const items = await fetchCrossrefWorksByUrl(url);
    return items.map((item) => ({
      item,
      hintCategory: inferYouthCategoryFromText(
        `${item.title?.[0] || ''} ${item.abstract || ''} ${j.nameEn}`
      ),
    }));
  });

  // 3. Crossref direct overseas 8 keyword queries
  const overseasPool = [...OVERSEAS_ENGLISH_KEYWORDS];
  const crOverseasResults = await runInBatches(overseasPool, 4, async (kw) => {
    crossrefCalls += 1;
    const url =
      `https://api.crossref.org/works` +
      `?query.title=${encodeURIComponent(`"${kw}"`)}` +
      `&filter=${encodeURIComponent(`from-pub-date:${fromDate},until-pub-date:${toDate}`)}` +
      `&sort=relevance&rows=5&mailto=schaum@mju.ac.kr`;
    const items = await fetchCrossrefWorksByUrl(url);
    return items
      .filter((it) => isYouthRelevantText(`${it.title?.[0] || ''} ${it['container-title']?.[0] || ''}`))
      .map((item) => ({
        item,
        hintCategory: inferYouthCategoryFromText(`${kw} ${item.title?.[0] || ''}`),
      }));
  });

  for (const group of [...crJournalResults, ...crOverseasResults]) {
    crDirectCandidates.push(...group);
  }

  // 4. Deduplicate & prioritize domestic papers first
  const seenAuthorYearSet = new Set<string>();
  const dedupedDrafts: CollectedPaperDraft[] = [];

  const isDuplicateDraft = (doi: string, oaId: string, title: string, firstAuthor: string, pubDate: string) => {
    const normTitle = normalizeText(title);
    const pubYear = pubDate.slice(0, 4);
    const authorYearKey =
      firstAuthor && firstAuthor !== '저자 정보 확인 중' && pubYear
        ? `${normalizeText(firstAuthor)}_${pubYear}_${normTitle.slice(0, 18)}`
        : '';

    if (!title || title.length < 3) return true;
    if (oaId && existingOaSet.has(oaId)) return true;
    if (doi && existingDoiSet.has(doi)) return true;
    if (existingTitleSet.has(normTitle)) return true;
    if (authorYearKey && seenAuthorYearSet.has(authorYearKey)) return true;

    existingTitleSet.add(normTitle);
    if (oaId) existingOaSet.add(oaId);
    if (doi) existingDoiSet.add(doi);
    if (authorYearKey) seenAuthorYearSet.add(authorYearKey);
    return false;
  };

  // Convert & enrich OpenAlex candidates
  const oaCandidatesList = Array.from(oaCandidateMap.values()).slice(0, maxFreshLimit);
  const enrichedOaPapers: CollectedPaperDraft[] = await Promise.all(
    oaCandidatesList.map(async ({ work, hintCategory }) => {
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

      const publisher = (
        work.primary_location?.source?.host_organization_name ||
        crItem?.publisher ||
        ''
      ).trim();

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
        ...(work.authorships?.flatMap((a) => [
          ...(a.countries || []),
          ...((a.institutions || []).map((i) => i.country_code || '').filter(Boolean)),
        ]) || []),
      ];
      const institutions = [
        ...(work.authorships?.flatMap((a) =>
          (a.institutions || []).map((i) => i.display_name || '').filter(Boolean)
        ) || []),
        ...(crItem?.author?.flatMap((a) => (a.affiliation || []).map((af) => af.name || '').filter(Boolean)) || []),
      ];
      const issns = [
        ...(work.primary_location?.source?.issn || []),
        ...(crItem?.ISSN || []),
      ];

      const regionInfo = classifyPaperRegion({
        language,
        title,
        journalName,
        publisher,
        abstract,
        doi: doiClean,
        issns,
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
        region: regionInfo.region,
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

  // Convert Crossref direct candidates
  const directCrDrafts: CollectedPaperDraft[] = [];
  for (const { item, hintCategory } of crDirectCandidates) {
    const draft = normalizeCrossrefCandidate(item, hintCategory, toDate);
    if (!draft) continue;
    if (draft.publicationDate < fromDate || draft.publicationDate > toDate) continue;
    directCrDrafts.push(draft);
  }

  // Merge OpenAlex + Crossref direct drafts, deduplicate per region while preserving journal diversity
  const uniqueDomestic: CollectedPaperDraft[] = [];
  const uniqueInternational: CollectedPaperDraft[] = [];

  const sortedPool = [...enrichedOaPapers, ...directCrDrafts].sort((a, b) =>
    (b.publicationDate || '').localeCompare(a.publicationDate || '')
  );

  for (const draft of sortedPool) {
    if (
      isDuplicateDraft(
        draft.doi,
        draft.openAlexId,
        draft.title,
        draft.authors[0] || '',
        draft.publicationDate
      )
    ) {
      continue;
    }
    if (draft.region === 'domestic') {
      uniqueDomestic.push(draft);
    } else {
      uniqueInternational.push(draft);
    }
  }

  // Round-robin interleave domestic drafts by journal so all 6 Korean Youth journals are represented
  const domesticByJournal = new Map<string, CollectedPaperDraft[]>();
  for (const d of uniqueDomestic) {
    const key = d.journalName || '기타';
    const arr = domesticByJournal.get(key) || [];
    arr.push(d);
    domesticByJournal.set(key, arr);
  }
  const interleavedDomestic: CollectedPaperDraft[] = [];
  const journalQueues = Array.from(domesticByJournal.values());
  let roundIdx = 0;
  while (interleavedDomestic.length < uniqueDomestic.length) {
    let addedInRound = false;
    for (const queue of journalQueues) {
      if (roundIdx < queue.length) {
        interleavedDomestic.push(queue[roundIdx]);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    roundIdx += 1;
  }

  // Domestic-first (~65%) + International complement (~35%), filling remaining slots if either pool is smaller
  const targetDomestic = Math.ceil(maxFreshLimit * 0.65);
  const targetIntl = Math.max(1, maxFreshLimit - targetDomestic);

  const pickedDomestic = interleavedDomestic.slice(0, targetDomestic);
  const pickedIntl = uniqueInternational.slice(0, targetIntl);
  dedupedDrafts.push(...pickedDomestic, ...pickedIntl);

  if (dedupedDrafts.length < maxFreshLimit) {
    const remainingPool = [
      ...interleavedDomestic.slice(pickedDomestic.length),
      ...uniqueInternational.slice(pickedIntl.length),
    ];
    for (const draft of remainingPool) {
      dedupedDrafts.push(draft);
      if (dedupedDrafts.length >= maxFreshLimit) break;
    }
  }

  const domesticCount = dedupedDrafts.filter((p) => p.region === 'domestic').length;
  const internationalCount = dedupedDrafts.length - domesticCount;
  const koreanCoverageNotice =
    !process.env.OPENALEX_API_KEY?.trim() && openAlexBudgetExhausted
      ? 'OpenAlex 공용 IP 할당량 제한(429)으로 Crossref 한국 청소년학 학술지·해외 키워드 기반 보완 수집을 수행했습니다. AI Studio Secrets에 무료 OPENALEX_API_KEY를 등록하면 OpenAlex 30개 확장 검색어도 함께 동작합니다.'
      : domesticCount < 3
        ? 'OpenAlex·Crossref 국내 학술지 색인 시차로 인해 일부 최신 국내 논문이 누락될 수 있습니다. 국회도서관·국립중앙도서관 API 키 설정 후 전체 국내 자료 연동이 가능합니다.'
        : '';

  res.json({
    papers: dedupedDrafts,
    stats: {
      collectedCount: dedupedDrafts.length,
      domesticCount,
      internationalCount,
      openAlexCalls,
      crossrefCalls,
      collectionErrors: collectionErrors.slice(0, 25),
      koreanCoverageNotice,
      fromDate,
      toDate,
      lookbackMonths,
      koreanKeywordsApplied: CORE_KOREAN_KEYWORDS.length + EXTENDED_KOREAN_KEYWORDS.length,
      overseasKeywordsApplied: OVERSEAS_ENGLISH_KEYWORDS.length,
    },
  });
}

async function searchGlobalOpenAlexAndCrossref(params: {
  query: string;
  regionScope?: 'all' | 'domestic' | 'international';
  lookbackMonths?: number;
  limit?: number;
}) {
  const cleanQuery = params.query.trim() || '청소년지도';
  const regionScope = params.regionScope || 'all';
  const { fromDate, toDate, lookbackMonths } = getDateRangeByMonths(params.lookbackMonths || 12);
  const limit = Math.min(Math.max(Number(params.limit || 10), 1), 20);

  let openAlexStatus: 'connected' | 'rate_limited_429' | 'error' = 'connected';
  let openAlexNote = '';
  const items: Array<{
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
  }> = [];

  const seenDoi = new Set<string>();
  const seenTitle = new Set<string>();

  // 1. Try OpenAlex first
  try {
    const filterParts = [`from_publication_date:${fromDate}`, `to_publication_date:${toDate}`, `default.search:${cleanQuery}`];
    if (regionScope === 'domestic' && /[가-힣]/.test(cleanQuery)) {
      filterParts.push('language:ko');
    }
    const oaWorks = await fetchOpenAlexWorks({
      filter: filterParts.join(','),
      page: 1,
      perPage: Math.min(limit, 8),
    });

    for (const work of oaWorks) {
      const title = (work.title || work.display_name || '').trim();
      if (!title) continue;
      const doiClean = normalizeDoi(work.doi);
      const normT = normalizeText(title);
      if ((doiClean && seenDoi.has(doiClean)) || seenTitle.has(normT)) continue;

      const journalName = work.primary_location?.source?.display_name || '학술지 미상';
      const publisher = work.primary_location?.source?.host_organization_name || '';
      const language = work.language || (/[가-힣]/.test(title) ? 'ko' : 'en');
      const countryCodes = [
        ...(work.primary_location?.source?.country_code ? [work.primary_location.source.country_code] : []),
        ...(work.authorships?.flatMap((a) => [
          ...(a.countries || []),
          ...((a.institutions || []).map((i) => i.country_code || '').filter(Boolean)),
        ]) || []),
      ];
      const institutions =
        work.authorships?.flatMap((a) =>
          (a.institutions || []).map((i) => i.display_name || '').filter(Boolean)
        ) || [];

      const regionInfo = classifyPaperRegion({
        language,
        title,
        journalName,
        publisher,
        doi: doiClean,
        issns: work.primary_location?.source?.issn || [],
        countryCodes,
        institutions,
      });

      if (regionScope !== 'all' && regionInfo.region !== regionScope) continue;
      if (doiClean) seenDoi.add(doiClean);
      seenTitle.add(normT);

      items.push({
        paperId: makeSafePaperId(work.id || '', doiClean, title),
        title: title.slice(0, 280),
        authors:
          (work.authorships || [])
            .map((a) => a.author?.display_name?.trim())
            .filter((n): n is string => Boolean(n))
            .slice(0, 8) || ['저자 정보 미제공'],
        journalName,
        publisher,
        publicationDate: work.publication_date || '',
        language,
        country: regionInfo.country,
        region: regionInfo.region,
        regionReason: regionInfo.reason,
        doi: doiClean,
        paperUrl:
          work.open_access?.oa_url ||
          work.primary_location?.landing_page_url ||
          (doiClean ? `https://doi.org/${doiClean}` : work.id || ''),
        source: 'OpenAlex',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === 'OPENALEX_DAILY_BUDGET_429') {
      openAlexStatus = 'rate_limited_429';
      openAlexNote =
        'OpenAlex 공용 IP 일일 할당량(429)이 소진되어 Crossref REST API 실데이터로 조회했습니다. (OPENALEX_API_KEY 등록 시 OpenAlex 동시 조회 가능)';
    } else {
      openAlexStatus = 'error';
      openAlexNote = `OpenAlex 조회 오류: ${msg}`;
    }
  }

  // 2. Query Crossref (Domestic Korean journals if domestic/all, and keyword search for international/all)
  const crTargets: Promise<CrossrefWorkItem[]>[] = [];
  if (regionScope === 'domestic' || regionScope === 'all') {
    for (const j of KOREAN_YOUTH_JOURNALS.slice(0, 4)) {
      crTargets.push(
        fetchCrossrefWorksByUrl(
          `https://api.crossref.org/prefixes/${j.doiPrefix}/works?filter=${encodeURIComponent(
            `from-pub-date:${fromDate},until-pub-date:${toDate}`
          )}&sort=published&order=desc&rows=3&mailto=schaum@mju.ac.kr`
        )
      );
    }
  }
  if (regionScope === 'international' || regionScope === 'all' || !/[가-힣]/.test(cleanQuery)) {
    const queryTerm = /[가-힣]/.test(cleanQuery) ? 'Korea youth' : `"${cleanQuery}"`;
    crTargets.push(
      fetchCrossrefWorksByUrl(
        `https://api.crossref.org/works?query.title=${encodeURIComponent(queryTerm)}&filter=${encodeURIComponent(
          `from-pub-date:${fromDate},until-pub-date:${toDate}`
        )}&sort=relevance&rows=5&mailto=schaum@mju.ac.kr`
      )
    );
  }

  const crBatches = await Promise.all(crTargets);
  for (const batch of crBatches) {
    for (const cr of batch) {
      const title = stripTags(String(cr.title?.[0] || '')).slice(0, 280);
      if (!title) continue;
      const doiClean = normalizeDoi(cr.DOI);
      const normT = normalizeText(title);
      if ((doiClean && seenDoi.has(doiClean)) || seenTitle.has(normT)) continue;

      const pubDate = formatCrossrefDate(cr);
      if (pubDate && (pubDate < fromDate || pubDate > toDate)) continue;

      const journalName = stripTags(String(cr['container-title']?.[0] || cr.publisher || '학술지 미상'));
      const publisher = stripTags(String(cr.publisher || ''));
      const language = cr.language || (/[가-힣]/.test(title) ? 'ko' : 'en');
      const affiliations = (cr.author || [])
        .flatMap((a) => (a.affiliation || []).map((af) => af.name || ''))
        .filter(Boolean);

      const regionInfo = classifyPaperRegion({
        language,
        title,
        journalName,
        publisher,
        abstract: cr.abstract ? stripTags(cr.abstract) : '',
        doi: doiClean,
        issns: cr.ISSN || [],
        institutions: affiliations,
      });

      if (regionScope !== 'all' && regionInfo.region !== regionScope) continue;
      if (doiClean) seenDoi.add(doiClean);
      seenTitle.add(normT);

      const authors = (cr.author || [])
        .map((a) => a.name || [a.family, a.given].filter(Boolean).join(' ').trim())
        .filter(Boolean)
        .slice(0, 8);

      items.push({
        paperId: makeSafePaperId('', doiClean, title),
        title,
        authors: authors.length > 0 ? authors : ['저자 정보 확인 중'],
        journalName,
        publisher,
        publicationDate: pubDate,
        language,
        country: regionInfo.country,
        region: regionInfo.region,
        regionReason: regionInfo.reason,
        doi: doiClean,
        paperUrl: cr.URL || (doiClean ? `https://doi.org/${doiClean}` : ''),
        source: 'Crossref',
      });
    }
  }

  // Sort matched query terms first, then newest date
  const qLower = cleanQuery.toLowerCase();
  const matchedGroup = KOREAN_KEYWORD_GROUPS.find((g) =>
    g.keywords.some((k) => k === cleanQuery || cleanQuery.includes(k))
  );
  const enTerms = matchedGroup?.enMatchTerms || [];

  items.sort((a, b) => {
    const aText = `${a.title} ${a.journalName} ${a.publisher}`.toLowerCase();
    const bText = `${b.title} ${b.journalName} ${b.publisher}`.toLowerCase();
    const aHit = aText.includes(qLower) || enTerms.some((t) => aText.includes(t)) ? 1 : 0;
    const bHit = bText.includes(qLower) || enTerms.some((t) => bText.includes(t)) ? 1 : 0;
    if (aHit !== bHit) return bHit - aHit;
    return (b.publicationDate || '').localeCompare(a.publicationDate || '');
  });

  const limited = items.slice(0, limit);
  const domesticCount = limited.filter((i) => i.region === 'domestic').length;
  const internationalCount = limited.length - domesticCount;

  return {
    ok: limited.length > 0 || openAlexStatus === 'connected',
    query: cleanQuery,
    regionScope,
    fromDate,
    toDate,
    lookbackMonths,
    openAlexStatus,
    openAlexKeyConfigured: Boolean(process.env.OPENALEX_API_KEY?.trim()),
    openAlexNote,
    totalReturned: limited.length,
    domesticCount,
    internationalCount,
    papers: limited,
    message:
      limited.length > 0
        ? `OpenAlex·Crossref 연계 조회 완료: 총 ${limited.length}건 (국내 ${domesticCount}건 · 해외 ${internationalCount}건 · 기간 ${fromDate}~${toDate})`
        : openAlexNote || '해당 조건에 일치하는 공개 논문이 검색되지 않았습니다.',
  };
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
    reportId?: string;
    monthLabel?: string;
    periodRange?: string;
    papers?: Array<{
      title: string;
      authors?: string[];
      mainCategory: string;
      region: string;
      publicationDate: string;
      journalName: string;
      citedByCount?: number;
      easySummary?: string;
      researchFindings?: string;
      practicalImplications?: string;
    }>;
  };

  const papers = Array.isArray(body.papers) ? body.papers.slice(0, 50) : [];
  if (papers.length === 0) {
    res.status(400).json({ error: '월간 보고서를 생성할 수집 논문이 없습니다.' });
    return;
  }

  try {
    const ai = getGeminiClient();
    const schedule = getKstScheduleInfo();
    const monthLabel = String(body.monthLabel || `${schedule.currentMonthKey.replace('-', '년 ')}월`)
      .trim()
      .slice(0, 60);
    const periodRange = String(body.periodRange || '최근 수집 논문 종합').trim().slice(0, 80);

    const domesticCount = papers.filter((p) => p.region === 'domestic').length;
    const internationalCount = papers.length - domesticCount;
    const categoryStats = YOUTH_CATEGORIES.map((cat) => {
      const count = papers.filter((p) => p.mainCategory === cat).length;
      return `${cat}: ${count}편`;
    }).join(', ');

    const dates = papers
      .map((p) => (p.publicationDate || '').slice(0, 10))
      .filter((d) => /^\d{4}/.test(d))
      .sort();
    const dateSpan = dates.length > 0 ? `${dates[0]} ~ ${dates[dates.length - 1]}` : '미상';

    const sanitizedReportId = body.reportId
      ? String(body.reportId)
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 48)
      : `report_${schedule.currentMonthKey.replace(/[^0-9]/g, '')}`;

    const prompt = [
      `당신은 명지대학교 대학원 청소년지도학과 연구정보 플랫폼의 월간 연구동향 보고서 수석 편집자입니다.`,
      `아래 실제로 수집·검증된 논문 메타데이터와 AI 요약만을 근거로 '${monthLabel} 청소년지도 연구동향 종합 보고서'를 한국어로 정교하게 작성하세요.`,
      ``,
      `[절대 준수 원칙]`,
      `1. 반드시 제공된 논문 목록에 포함된 논문 제목, 저자, 학술지, 연구결과만 인용·종합하세요. 목록에 없는 논문, 저자, 수치를 절대 지어내지 마세요.`,
      `2. 각 항목은 대학원생(석·박사 과정)과 청소년지도 현장 실무자가 한눈에 파악할 수 있도록 번호/불릿(•)과 문단을 명확히 구분해 작성하세요.`,
      `3. 각 항목의 분량 제한을 초과하지 마세요 (categoryFlows 1800자 이내, notablePapers 1500자 이내, 나머지 항목 각 1200자 이내).`,
      ``,
      `[대상 코퍼스 통계]`,
      `- 보고서 기간/범위: ${periodRange} (논문 발행일 분포: ${dateSpan})`,
      `- 분석 대상 편수: 총 ${papers.length}편 (국내 ${domesticCount}편 · 해외 ${internationalCount}편)`,
      `- 6대 분야별 분포: ${categoryStats}`,
      ``,
      `[작성 지침]`,
      `- categoryFlows: 6대 분야별 연구 편수 분포를 바탕으로 이번 기간 어느 분야의 연구가 활발했는지, 국내 연구와 해외 연구의 주제적 차이가 무엇인지 구조적으로 서술`,
      `- notablePapers: 제공된 논문 중 연구 의의·현장 적용성·주제 대표성이 높은 논문 3~5편을 선별하여 '[논문 제목] (저자/학술지, 발행연월)' 형식과 선정 사유를 개조식으로 작성`,
      `- keyThemes: 전체 논문들을 관통하는 핵심 연구 키워드·주제군 3~4가지를 묶어 '• 주제명: 상세 내용' 형식으로 작성`,
      `- commonFindings: 초록 및 요약에서 확인되는 주요 방법론적 경향과 공통 실증 결과를 종합`,
      `- researchGaps: 현재 수집된 논문군에서 상대적으로 부족한 대상·분야·연구방법 및 후속 연구가 필요한 공백을 구체적으로 제안`,
      `- fieldImplications: 청소년수련관·문화의집·상담복지센터 등 청소년지도 현장과 정책·대학원 연구자를 위한 실천적 시사점을 제언`,
      ``,
      `[수집된 논문 목록 (${papers.length}편)]`,
      JSON.stringify(papers, null, 2).slice(0, 22000),
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
        reportId: sanitizedReportId || `report_${schedule.currentMonthKey.replace(/[^0-9]/g, '')}`,
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

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim() || '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isOriginAllowed(origin: string | undefined, allowlist: string[]): boolean {
  if (!origin) return true;
  const cleanOrigin = origin.trim().replace(/\/+$/, '');

  if (allowlist.length > 0) {
    if (allowlist.includes('*')) return true;
    return allowlist.some((pattern) => {
      if (pattern === cleanOrigin) return true;
      if (pattern.startsWith('https://*.')) {
        const suffix = pattern.slice('https://*'.length); // e.g. ".github.io"
        return cleanOrigin.startsWith('https://') && cleanOrigin.endsWith(suffix);
      }
      return false;
    });
  }

  try {
    const parsed = new URL(cleanOrigin);
    const host = parsed.hostname.toLowerCase();
    if (
      parsed.protocol === 'https:' &&
      (host.endsWith('.github.io') ||
        host.endsWith('.run.app') ||
        host.endsWith('.web.app') ||
        host.endsWith('.firebaseapp.com'))
    ) {
      return true;
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return true;
    }
    const appUrl = process.env.APP_URL?.trim();
    if (appUrl) {
      const appOrigin = new URL(appUrl).origin;
      if (parsed.origin === appOrigin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function handleTestGeminiAi(_req: Request, res: Response) {
  const started = Date.now();
  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        '다음 연구 주제를 청소년지도학과 관점에서 1문장 한국어 요약과 가장 알맞은 6대 분야 1개로 분류해 JSON으로 응답하세요.',
        '제목: 디지털 전환 시대 청소년지도사의 AI 리터러시 역량과 청소년 참여활동 활성화 방안',
      ].join('\n'),
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            sampleCategory: {
              type: Type.STRING,
              enum: [...YOUTH_CATEGORIES],
            },
            sampleSummary: { type: Type.STRING },
          },
          required: ['sampleCategory', 'sampleSummary'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      sampleCategory?: string;
      sampleSummary?: string;
    };

    res.json({
      ok: true,
      model: GEMINI_MODEL,
      latencyMs: Date.now() - started,
      sampleCategory: parsed.sampleCategory || YOUTH_CATEGORIES[3],
      sampleSummary: (parsed.sampleSummary || 'AI 요약 테스트 응답을 정상 수신했습니다.').slice(
        0,
        300
      ),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const mapped = mapGeminiErrorMessage(err);
    res.status(mapped.status).json({
      ok: false,
      model: GEMINI_MODEL,
      latencyMs: Date.now() - started,
      error: mapped.message,
    });
  }
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const corsAllowlist = parseAllowedOrigins();

  app.use('/api', (req: Request, res: Response, next) => {
    const requestOrigin =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowed = isOriginAllowed(requestOrigin, corsAllowlist);

    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Requested-With'
    );
    res.setHeader('Access-Control-Max-Age', '86400');

    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
    }

    if (req.method === 'OPTIONS') {
      if (!allowed) {
        res.status(403).json({
          ok: false,
          error:
            '허용되지 않은 도메인(CORS)에서의 API 요청입니다. Cloud Run 환경변수 ALLOWED_ORIGINS를 확인해 주세요.',
        });
        return;
      }
      res.status(204).end();
      return;
    }

    if (!allowed) {
      res.status(403).json({
        ok: false,
        error:
          '허용되지 않은 도메인(CORS)에서의 API 요청입니다. Cloud Run 환경변수 ALLOWED_ORIGINS를 확인해 주세요.',
      });
      return;
    }

    next();
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      model: GEMINI_MODEL,
      environment: process.env.K_SERVICE ? 'cloud_run' : 'node_server',
      corsMode: corsAllowlist.length > 0 ? 'custom_allowlist' : 'github_pages_default',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      nanetConfigured: Boolean(process.env.NANET_API_KEY?.trim()),
      nlConfigured: Boolean(process.env.NL_API_KEY?.trim()),
      dbpiaConfigured: Boolean(process.env.DBPIA_API_KEY?.trim()),
      openAlexKeyConfigured: Boolean(process.env.OPENALEX_API_KEY?.trim()),
      schedule: getKstScheduleInfo(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post('/api/health/ai-test', handleTestGeminiAi);

  app.get('/api/sources/status', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      sources: buildAcademicSourcesStatus(),
      koreanKeywords: {
        core: [...CORE_KOREAN_KEYWORDS],
        extended: [...EXTENDED_KOREAN_KEYWORDS],
        totalCount: CORE_KOREAN_KEYWORDS.length + EXTENDED_KOREAN_KEYWORDS.length,
      },
      overseasKeywords: [...OVERSEAS_ENGLISH_KEYWORDS],
      koreanJournals: KOREAN_YOUTH_JOURNALS.map((j) => ({
        nameKo: j.nameKo,
        nameEn: j.nameEn,
        publisherEn: j.publisherEn,
        issn: j.issn,
        doiPrefix: j.doiPrefix,
      })),
      checkedAtIso: new Date().toISOString(),
    });
  });

  app.post('/api/sources/nanet/search', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        query?: string;
        pageNo?: number;
        displayLines?: number;
      };
      const result = await searchNanetOpenApi({
        query: typeof body.query === 'string' ? body.query : '청소년지도',
        pageNo: body.pageNo,
        displayLines: body.displayLines,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        configured: Boolean(process.env.NANET_API_KEY?.trim()),
        status: 'api_error',
        source: 'nanet',
        papers: [],
        totalCount: 0,
        message:
          err instanceof Error
            ? `국회도서관 API 호출 중 네트워크 오류가 발생했습니다: ${err.message}`
            : '국회도서관 API 호출 중 오류가 발생했습니다.',
      });
    }
  });

  app.post('/api/sources/nl/search', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        query?: string;
        category?: string;
        pageNo?: number;
        pageSize?: number;
      };
      const result = await searchNlOpenApi({
        query: typeof body.query === 'string' ? body.query : '청소년지도',
        category: typeof body.category === 'string' ? body.category : '',
        pageNo: body.pageNo,
        pageSize: body.pageSize,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        configured: Boolean(process.env.NL_API_KEY?.trim()),
        status: 'api_error',
        source: 'nl',
        papers: [],
        totalCount: 0,
        message:
          err instanceof Error
            ? `국립중앙도서관 API 호출 중 네트워크 오류가 발생했습니다: ${err.message}`
            : '국립중앙도서관 API 호출 중 오류가 발생했습니다.',
      });
    }
  });

  app.post('/api/sources/global/search', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        query?: string;
        regionScope?: 'all' | 'domestic' | 'international';
        lookbackMonths?: number;
        limit?: number;
      };
      const result = await searchGlobalOpenAlexAndCrossref({
        query: typeof body.query === 'string' ? body.query : '청소년지도',
        regionScope:
          body.regionScope === 'domestic' || body.regionScope === 'international'
            ? body.regionScope
            : 'all',
        lookbackMonths: body.lookbackMonths,
        limit: body.limit,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        totalReturned: 0,
        domesticCount: 0,
        internationalCount: 0,
        papers: [],
        message:
          err instanceof Error
            ? `OpenAlex·Crossref 실데이터 조회 중 오류가 발생했습니다: ${err.message}`
            : 'OpenAlex·Crossref 실데이터 조회 중 오류가 발생했습니다.',
      });
    }
  });

  app.post('/api/sources/dbpia/search', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        query?: string;
        sortType?: '1' | '2';
        pageNo?: number;
        pageCount?: number;
      };
      const result = await searchDbpiaOpenApi({
        query: typeof body.query === 'string' ? body.query : '청소년지도',
        sortType: body.sortType === '1' ? '1' : '2',
        pageNo: body.pageNo,
        pageCount: body.pageCount,
      });
      res.json(result);
    } catch (err) {
      res.status(502).json({
        ok: false,
        configured: Boolean(process.env.DBPIA_API_KEY?.trim()),
        status: 'api_error',
        source: 'dbpia',
        papers: [],
        totalCount: 0,
        message:
          err instanceof Error
            ? `DBpia Open API 호출 중 네트워크 오류가 발생했습니다: ${err.message}`
            : 'DBpia Open API 호출 중 오류가 발생했습니다.',
      });
    }
  });

  app.get('/api/papers/schedule-info', (req: Request, res: Response) => {
    const atParam = typeof req.query.at === 'string' ? new Date(req.query.at) : new Date();
    res.json(getKstScheduleInfo(atParam));
  });

  app.post('/api/papers/schedule-check', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      nowIso?: string;
      lastSyncedAtIso?: string | null;
      scheduleCron?: string;
      autoEnabled?: boolean;
      papersCount?: number;
    };
    const nowInput = body.nowIso ? new Date(body.nowIso) : new Date();
    res.json(
      evaluateServerMonthlySchedule({
        nowInput,
        lastSyncedAtIso: body.lastSyncedAtIso ?? null,
        scheduleCron: body.scheduleCron ?? '0 3 1 * *',
        autoEnabled: body.autoEnabled ?? true,
        papersCount: Number(body.papersCount ?? 0),
      })
    );
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
