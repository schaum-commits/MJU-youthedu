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
  staticHostingUnavailable?: boolean;
}

let activeYouthSyncPromise: Promise<YouthSyncRunResult> | null = null;

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

export function buildGoogleScholarPaperUrl(title: string, firstAuthor?: string): string {
  const queryText = firstAuthor && firstAuthor !== '저자 정보 확인 중'
    ? `${title} ${firstAuthor}`
    : title;
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

  // Construct Asia/Seoul (+09:00) timestamp for 1st day 03:00:00 KST
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
    const res = await fetch('/api/papers/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        monthLabel: kst.currentMonthLabel,
        periodRange: `최근 12개월 수집 논문 ${papers.length}편 종합`,
        papers: payloadPapers,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        message: '현재 호스팅 환경에서는 월간 보고서 AI 생성 API를 호출할 수 없습니다.',
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
      periodRange: (r.periodRange || '최근 12개월').slice(0, 80),
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
  generateReportToo = true,
}: {
  triggerType: 'manual' | 'scheduled_monthly';
  authUser: User;
  actorName: string;
  existingPapers: PaperRecord[];
  autoEnabled?: boolean;
  currentStatus?: ResearchSyncStatus | null;
  perCategoryLimit?: number;
  generateReportToo?: boolean;
}): Promise<YouthSyncRunResult> {
  if (activeYouthSyncPromise) {
    return activeYouthSyncPromise;
  }

  activeYouthSyncPromise = (async (): Promise<YouthSyncRunResult> => {
    const kst = getKstScheduleContext();
    const statusRef = doc(db, 'settings', 'researchSync');
    const safeActorName = (actorName || '원우회 관리자').slice(0, LIMITS.displayName);

    const existingDois = existingPapers
      .map((p) => normalizeDoi(p.doi))
      .filter(Boolean);
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
        lastSyncMessage:
          'OpenAlex·Crossref에서 6개 분야 최근 12개월 논문을 수집하고 Gemini AI 분석을 진행 중입니다...',
        windowLabel: currentStatus?.windowLabel || '최근 12개월',
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
      // Step 1: Collect from OpenAlex + Crossref
      const collectRes = await fetch('/api/papers/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          existingDois,
          existingOpenAlexIds,
          existingTitles,
          perCategoryLimit,
        }),
      });

      const collectType = collectRes.headers.get('content-type') || '';
      if (!collectType.includes('application/json')) {
        const msg =
          '현재 정적 호스팅 환경에서는 논문 자동 수집 API 서버를 호출할 수 없습니다. AI Studio 서버 환경에서 실행하거나 이미 저장된 연구동향 아카이브를 이용해 주세요.';
        await setDoc(statusRef, {
          autoEnabled,
          intervalDays: MONTHLY_INTERVAL_DAYS,
          ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
          nextSyncAt: kst.nextRunTimestamp,
          lastSyncStatus: currentStatus?.lastSyncedAt ? currentStatus.lastSyncStatus : 'error',
          lastSyncMode: triggerType === 'scheduled_monthly' ? 'monthly' : 'manual',
          lastSyncCount: currentStatus?.lastSyncCount ?? 0,
          lastSyncMessage: msg.slice(0, 400),
          windowLabel: currentStatus?.windowLabel || '최근 12개월',
          scheduleCron: MONTHLY_CRON,
          timezone: MONTHLY_TIMEZONE,
          updatedByUid: authUser.uid,
          updatedByName: safeActorName,
          updatedAt: serverTimestamp(),
        });
        return {
          ok: false,
          collectedCount: 0,
          newPapersCount: 0,
          analyzedSuccessCount: 0,
          analyzedFailedCount: 0,
          message: msg,
          staticHostingUnavailable: true,
        };
      }

      const collectJson = (await collectRes.json()) as {
        papers?: CollectedPaperDraft[];
        stats?: {
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
        error?: string;
      };

      if (!collectRes.ok) {
        throw new Error(collectJson.error || `논문 수집 서버 오류 (${collectRes.status})`);
      }

      const collected = Array.isArray(collectJson.papers) ? collectJson.papers : [];
      const stats = collectJson.stats;
      const windowLabel =
        stats?.fromDate && stats?.toDate ? `${stats.fromDate} ~ ${stats.toDate}` : '최근 12개월';
      const collectionErrors = sanitizeStringArray(stats?.collectionErrors, 25, 240);
      const koreanCoverageNotice = (stats?.koreanCoverageNotice || '').slice(0, 400);

      // Deduplicate once more against existingPapers in client memory
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
      const analysisErrors: string[] = [];
      const analyzedById = new Map<string, AnalyzedPaperPayload>();

      // Step 2: Analyze ONLY new papers with Gemini AI
      if (newDrafts.length > 0) {
        const analyzeRes = await fetch('/api/papers/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            papers: newDrafts,
          }),
        });

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
          throw new Error(analyzeJson.error || `AI 논문 분석 서버 오류 (${analyzeRes.status})`);
        }

        const results = Array.isArray(analyzeJson.results) ? analyzeJson.results : [];
        results.forEach((r) => analyzedById.set(r.paperId, r));
        geminiCalls = analyzeJson.stats?.geminiCalls ?? results.length;
        estimatedTokens = analyzeJson.stats?.estimatedTokens ?? 0;
        analyzedSuccessCount = analyzeJson.stats?.analyzedSuccessCount ?? 0;
        analyzedFailedCount = analyzeJson.stats?.analyzedFailedCount ?? 0;
        analysisErrors.push(...sanitizeStringArray(analyzeJson.stats?.analysisErrors, 25, 240));
      }

      // Step 3: Write new papers, syncLog, and settings/researchSync atomically
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
          analysisBasis: (ai?.analysisBasis || '초록 기반 분석').slice(0, 100),
          analysisStatus: ai?.analysisStatus || 'failed',
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
        if (ai?.policyImplications) {
          paperDoc.policyImplications = ai.policyImplications.slice(0, 2000);
        }
        if (ai?.easySummary) paperDoc.easySummary = ai.easySummary.slice(0, 2500);
        if (ai?.analysisError) paperDoc.analysisError = ai.analysisError.slice(0, 500);

        batch.set(doc(db, 'papers', draft.paperId), paperDoc);
        savedRecordsForReport.unshift(paperDoc as unknown as PaperRecord);
      });

      const domesticCount = newDrafts.filter((p) => p.region === 'domestic').length;
      const internationalCount = newDrafts.length - domesticCount;
      const logId = `log_${Date.now()}`;
      const logStatus =
        collectionErrors.length > 0 || analyzedFailedCount > 0 ? 'partial' : 'success';

      batch.set(doc(db, 'syncLogs', logId), {
        logId,
        triggerType,
        status: logStatus,
        collectedCount: Math.max(0, Math.round(collected.length)),
        newPapersCount: Math.max(0, Math.round(newDrafts.length)),
        domesticCount: Math.max(0, Math.round(domesticCount)),
        internationalCount: Math.max(0, Math.round(internationalCount)),
        analyzedSuccessCount: Math.max(0, Math.round(analyzedSuccessCount)),
        analyzedFailedCount: Math.max(0, Math.round(analyzedFailedCount)),
        openAlexCalls: Math.max(0, Math.round(stats?.openAlexCalls ?? 0)),
        crossrefCalls: Math.max(0, Math.round(stats?.crossrefCalls ?? 0)),
        geminiCalls: Math.max(0, Math.round(geminiCalls)),
        estimatedTokens: Math.max(0, Math.round(estimatedTokens)),
        collectionErrors,
        analysisErrors,
        ...(koreanCoverageNotice ? { koreanCoverageNotice } : {}),
        executedByUid: authUser.uid,
        executedByName: safeActorName,
        createdAt: serverTimestamp(),
      });

      const summaryMessage =
        newDrafts.length > 0
          ? `최근 12개월 신규 논문 ${newDrafts.length}편(국내 ${domesticCount} · 해외 ${internationalCount}) 수집 및 AI 분석 완료(${analyzedSuccessCount}성공 / ${analyzedFailedCount}실패).`
          : 'OpenAlex·Crossref 최신 논문을 점검했으며, 신규 미등록 논문이 없어 기존 DB가 최신 상태입니다.';

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

      if (generateReportToo && savedRecordsForReport.length > 0 && newDrafts.length > 0) {
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
        analyzedFailedCount,
        message: summaryMessage,
      };
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : '논문 자동 수집 및 AI 분석에 실패했습니다.';
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
          windowLabel: currentStatus?.windowLabel || '최근 12개월',
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
      message: '재분석이 필요한 실패 논문이 없습니다.',
    };
  }

  const safeActorName = (actorName || '원우회 관리자').slice(0, LIMITS.displayName);

  try {
    const res = await fetch('/api/papers/analyze', {
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
        message: '현재 호스팅 환경에서는 재분석 API 서버를 호출할 수 없습니다.',
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
      throw new Error(data.error || `재분석 요청 오류 (${res.status})`);
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
      message: `실패 논문 재분석 완료: ${successCount}건 성공, ${failedCount}건 실패`,
    };
  } catch (error) {
    return {
      ok: false,
      successCount: 0,
      failedCount: failedPapers.length,
      message: error instanceof Error ? error.message : '실패 논문 재분석 중 오류가 발생했습니다.',
    };
  }
}

export async function togglePaperVisibility(paper: PaperRecord): Promise<void> {
  await updateDoc(doc(db, 'papers', paper.paperId), {
    isPublished: !paper.isPublished,
    updatedAt: serverTimestamp(),
  });
}
