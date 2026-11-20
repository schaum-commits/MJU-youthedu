import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Calendar,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileBarChart2,
  Globe,
  Info,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getActiveApiBaseUrl, isLikelyStaticHosting } from '../lib/apiConfig';
import {
  buildGoogleScholarCategoryUrl,
  buildGoogleScholarPaperUrl,
  collectAndAnalyzePapers,
  DbpiaSearchTestResult,
  generateMonthlyTrendReport,
  getKstScheduleContext,
  isSyncActivelyRunning,
  MonthlyReportScope,
  retryFailedPapers,
  testDbpiaPaperSearch,
} from '../lib/youthPaperSync';
import {
  MonthlyTrendReport,
  PageTab,
  PaperRecord,
  ResearchSyncStatus,
  YOUTH_RESEARCH_CATEGORIES,
  YouthResearchCategory,
} from '../types/community';
import { CloudRunServerBar } from './CloudRunServerBar';
import {
  formatKoreanDateTime,
  NotionCallout,
  NotionSidePeekDrawer,
} from './NotionPrimitives';

type SubViewMode = 'papers' | 'reports' | 'dbpia';

const DBPIA_QUICK_KEYWORDS = [
  '청소년지도',
  '청소년지도자',
  '청소년활동',
  '청소년 정책',
  '청소년 참여',
  '청소년 진로',
  '청소년 리더십',
  'AI와 청소년',
  '학교 밖 청소년',
] as const;

export function YouthResearchTrendsPage({
  papers,
  monthlyReports,
  researchSyncStatus,
  onNavigate,
}: {
  papers: PaperRecord[];
  monthlyReports: MonthlyTrendReport[];
  researchSyncStatus: ResearchSyncStatus | null;
  onNavigate: (tab: PageTab) => void;
}) {
  const { authUser, profile, isAdmin } = useAuth();
  const [viewMode, setViewMode] = useState<SubViewMode>('papers');
  const [selectedCategory, setSelectedCategory] = useState<'전체' | YouthResearchCategory>('전체');
  const [regionFilter, setRegionFilter] = useState<'all' | 'domestic' | 'international'>('all');
  const [periodFilter, setPeriodFilter] = useState<'all' | '3m' | '6m' | '12m' | '60m'>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'open_access'>('all');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'cited'>('newest');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaper, setSelectedPaper] = useState<PaperRecord | null>(null);
  const [copiedPaperId, setCopiedPaperId] = useState<string | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [reportScope, setReportScope] = useState<MonthlyReportScope>('all');
  const [copiedReportId, setCopiedReportId] = useState<string | null>(null);
  const [runningLookback, setRunningLookback] = useState<3 | 12 | 60 | null>(null);
  const [syncProgressText, setSyncProgressText] = useState<string | null>(null);
  const [retryingAnalysis, setRetryingAnalysis] = useState(false);
  const [retryProgress, setRetryProgress] = useState<{ done: number; total: number } | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [dbpiaQuery, setDbpiaQuery] = useState('청소년지도');
  const [dbpiaSortType, setDbpiaSortType] = useState<'2' | '1'>('2');
  const [dbpiaPage, setDbpiaPage] = useState(1);
  const [dbpiaSearching, setDbpiaSearching] = useState(false);
  const [dbpiaResult, setDbpiaResult] = useState<DbpiaSearchTestResult | null>(null);
  const [actionBanner, setActionBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const kstContext = useMemo(() => getKstScheduleContext(), []);

  // Dashboard metrics calculated directly from collected papers
  const dashboardStats = useMemo(() => {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoff12mIso = oneYearAgo.toISOString().slice(0, 10);

    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff3mIso = threeMonthsAgo.toISOString().slice(0, 10);

    const recent12MonthsPapers = papers.filter((p) => (p.publicationDate || '') >= cutoff12mIso);
    const recent3MonthsPapers = papers.filter((p) => (p.publicationDate || '') >= cutoff3mIso);
    const currentMonthPrefix = kstContext.currentMonthKey; // YYYY-MM

    const monthlyNewCount = papers.filter((p) => {
      if (p.createdAt && typeof p.createdAt.toDate === 'function') {
        const createdCtx = getKstScheduleContext(p.createdAt.toDate());
        return createdCtx.currentMonthKey === currentMonthPrefix;
      }
      return (p.publicationDate || '').startsWith(currentMonthPrefix);
    }).length;

    const domesticCount = papers.filter((p) => p.region === 'domestic').length;
    const internationalCount = papers.length - domesticCount;
    const domesticPct =
      papers.length > 0 ? Math.round((domesticCount / papers.length) * 100) : 0;
    const internationalPct = papers.length > 0 ? 100 - domesticPct : 0;

    const categoryCounts: Record<YouthResearchCategory, number> = {
      '청소년지도 및 청소년 활동': 0,
      '청소년 진로 및 리더십': 0,
      '청소년 참여 및 사회적 성장': 0,
      'AI 및 디지털 시대의 청소년': 0,
      '청소년 교육 및 평생학습': 0,
      '청소년 문제 및 사회 변화': 0,
    };

    papers.forEach((p) => {
      if (categoryCounts[p.mainCategory] !== undefined) {
        categoryCounts[p.mainCategory] += 1;
      }
    });

    const analyzedCount = papers.filter((p) => p.analysisStatus === 'completed').length;
    const openAccessCount = papers.filter((p) => p.openAccess).length;

    const yearMap = new Map<string, number>();
    papers.forEach((p) => {
      const y = (p.publicationDate || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) {
        yearMap.set(y, (yearMap.get(y) || 0) + 1);
      }
    });
    const yearBreakdown = Array.from(yearMap.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 6);

    return {
      totalCount: papers.length,
      recent12MonthsCount: recent12MonthsPapers.length,
      recent3MonthsCount: recent3MonthsPapers.length,
      monthlyNewCount,
      domesticCount,
      internationalCount,
      domesticPct,
      internationalPct,
      analyzedCount,
      openAccessCount,
      yearBreakdown,
      categoryCounts,
    };
  }, [papers, kstContext.currentMonthKey]);

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    papers.forEach((p) => {
      const y = (p.publicationDate || '').slice(0, 4);
      if (/^\d{4}$/.test(y)) years.add(y);
    });
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [papers]);

  const topKeywords = useMemo(() => {
    const freq = new Map<string, number>();
    papers.forEach((p) => {
      (p.keywords || []).forEach((kw) => {
        const clean = kw.trim();
        if (clean.length >= 2) {
          freq.set(clean, (freq.get(clean) || 0) + 1);
        }
      });
    });
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([kw, count]) => ({ kw, count }));
  }, [papers]);

  const pendingOrFailedPapers = useMemo(
    () => papers.filter((p) => p.analysisStatus === 'failed' || p.analysisStatus === 'pending'),
    [papers]
  );

  const filteredPapers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    let periodCutoffIso = '';
    if (periodFilter !== 'all') {
      const monthsBack =
        periodFilter === '3m'
          ? 3
          : periodFilter === '6m'
            ? 6
            : periodFilter === '60m'
              ? 60
              : 12;
      const d = new Date();
      d.setMonth(d.getMonth() - monthsBack);
      periodCutoffIso = d.toISOString().slice(0, 10);
    }
    const list = papers.filter((p) => {
      if (selectedCategory !== '전체') {
        const matchesMain = p.mainCategory === selectedCategory;
        const matchesRelated = (p.relatedCategories || []).includes(selectedCategory);
        if (!matchesMain && !matchesRelated) return false;
      }
      if (regionFilter !== 'all' && p.region !== regionFilter) return false;
      if (statusFilter === 'completed' && p.analysisStatus !== 'completed') return false;
      if (statusFilter === 'open_access' && !p.openAccess) return false;
      if (periodCutoffIso && (p.publicationDate || '') < periodCutoffIso) return false;
      if (yearFilter !== 'all' && !(p.publicationDate || '').startsWith(yearFilter)) {
        return false;
      }
      if (q) {
        const haystack = [
          p.title,
          ...(p.authors || []),
          p.journalName,
          ...(p.keywords || []),
          p.easySummary || '',
          p.abstract || '',
          p.mainCategory,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortOrder === 'oldest') {
        return (a.publicationDate || '').localeCompare(b.publicationDate || '');
      }
      if (sortOrder === 'cited') {
        const diff = (b.citedByCount || 0) - (a.citedByCount || 0);
        if (diff !== 0) return diff;
      }
      return (b.publicationDate || '').localeCompare(a.publicationDate || '');
    });
  }, [
    papers,
    selectedCategory,
    regionFilter,
    statusFilter,
    periodFilter,
    yearFilter,
    searchQuery,
    sortOrder,
  ]);

  const relatedPapersForDrawer = useMemo(() => {
    if (!selectedPaper) return [];
    return papers
      .filter(
        (p) =>
          p.paperId !== selectedPaper.paperId &&
          (p.mainCategory === selectedPaper.mainCategory ||
            (p.relatedCategories || []).includes(selectedPaper.mainCategory))
      )
      .slice(0, 3);
  }, [papers, selectedPaper]);

  const activeReport = useMemo(() => {
    if (monthlyReports.length === 0) return null;
    if (selectedReportId) {
      return monthlyReports.find((r) => r.reportId === selectedReportId) || monthlyReports[0];
    }
    return monthlyReports[0];
  }, [monthlyReports, selectedReportId]);

  const isSyncRunning =
    runningLookback !== null || isSyncActivelyRunning(researchSyncStatus);

  const handleRunManualSync = async (lookbackMonths: 3 | 12 | 60) => {
    if (!authUser || isSyncRunning) return;
    setRunningLookback(lookbackMonths);
    setSyncProgressText(`OpenAlex·Crossref 최근 ${lookbackMonths}개월 논문 수집 준비 중...`);
    setActionBanner(null);
    try {
      const result = await collectAndAnalyzePapers({
        triggerType: 'manual',
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        existingPapers: papers,
        autoEnabled: researchSyncStatus?.autoEnabled ?? true,
        currentStatus: researchSyncStatus,
        lookbackMonths,
        perCategoryLimit: lookbackMonths === 3 ? 4 : lookbackMonths === 60 ? 2 : 3,
        generateReportToo: true,
        onStatusChange: (msg) => setSyncProgressText(msg),
      });
      setActionBanner({
        type: result.ok ? 'ok' : 'err',
        text: result.message,
      });
    } finally {
      setRunningLookback(null);
      setSyncProgressText(null);
    }
  };

  const handleRunPendingAiAnalysis = async () => {
    if (!authUser || retryingAnalysis || pendingOrFailedPapers.length === 0) return;
    setRetryingAnalysis(true);
    setRetryProgress({ done: 0, total: Math.min(pendingOrFailedPapers.length, 48) });
    setActionBanner(null);
    try {
      const result = await retryFailedPapers({
        failedPapers: pendingOrFailedPapers,
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        maxPapers: 48,
        onProgress: (done, total) => setRetryProgress({ done, total }),
      });
      setActionBanner({
        type: result.ok ? 'ok' : 'err',
        text: result.message,
      });
    } finally {
      setRetryingAnalysis(false);
      setRetryProgress(null);
    }
  };

  const handleGenerateReportNow = async () => {
    if (!authUser || generatingReport) return;
    setGeneratingReport(true);
    setActionBanner(null);
    try {
      const res = await generateMonthlyTrendReport({
        papers,
        newPapersCount: dashboardStats.monthlyNewCount,
        authUser,
        isPublished: true,
        scope: reportScope,
      });
      setActionBanner({
        type: res.ok ? 'ok' : 'err',
        text: res.message,
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const formatReportMarkdown = (report: MonthlyTrendReport) => {
    const domPct =
      report.totalPapersCount > 0
        ? Math.round((report.domesticCount / report.totalPapersCount) * 100)
        : 0;
    const intlPct = report.totalPapersCount > 0 ? 100 - domPct : 0;
    return [
      `# ${report.monthLabel} 청소년지도 연구동향 종합 보고서`,
      `- 기관: 명지대학교 대학원 청소년지도학과 원우회`,
      `- 대상 범위: ${report.periodRange}`,
      `- 분석 편수: 총 ${report.totalPapersCount}편 (신규 ${report.newPapersCount}편 · 국내 ${report.domesticCount}편 [${domPct}%] / 해외 ${report.internationalCount}편 [${intlPct}%])`,
      ``,
      `## 01. 월간 분야별 연구 흐름`,
      report.categoryFlows,
      ``,
      `## 02. 주목할 만한 논문`,
      report.notablePapers,
      ``,
      `## 03. 주요 연구 주제`,
      report.keyThemes,
      ``,
      `## 04. 공통적인 연구 결과`,
      report.commonFindings,
      ``,
      `## 05. 연구 공백 및 후속 연구 과제`,
      report.researchGaps,
      ``,
      `## 06. 청소년지도 현장에 대한 시사점`,
      report.fieldImplications,
      ``,
    ].join('\n');
  };

  const handleCopyReportMarkdown = async (report: MonthlyTrendReport) => {
    try {
      await navigator.clipboard.writeText(formatReportMarkdown(report));
      setCopiedReportId(report.reportId);
      setTimeout(() => {
        setCopiedReportId((prev) => (prev === report.reportId ? null : prev));
      }, 2000);
    } catch {
      // Clipboard fallback ignored safely
    }
  };

  const handleDownloadReportMarkdown = (report: MonthlyTrendReport) => {
    const md = formatReportMarkdown(report);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `청소년지도_연구동향보고서_${report.reportId}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintReport = () => {
    window.print();
  };

  const handleRunDbpiaSearch = async (overrideQuery?: string, nextPage = 1) => {
    const q = (overrideQuery ?? dbpiaQuery).trim() || '청소년지도';
    if (overrideQuery !== undefined) {
      setDbpiaQuery(q);
    }
    setDbpiaSearching(true);
    setDbpiaPage(nextPage);
    try {
      const res = await testDbpiaPaperSearch(q, dbpiaSortType, nextPage, 10);
      setDbpiaResult(res);
    } finally {
      setDbpiaSearching(false);
    }
  };

  const handleCopyCitation = async (paper: PaperRecord) => {
    const authorsText =
      (paper.authors || []).length > 0 ? (paper.authors || []).join(', ') : '저자 미상';
    const yearText = (paper.publicationDate || '').slice(0, 4) || '연도 미상';
    const doiPart = paper.doi ? ` https://doi.org/${paper.doi}` : paper.paperUrl ? ` ${paper.paperUrl}` : '';
    const citation = `${authorsText} (${yearText}). ${paper.title}. ${paper.journalName}.${doiPart}`;
    try {
      await navigator.clipboard.writeText(citation);
      setCopiedPaperId(paper.paperId);
      setTimeout(() => {
        setCopiedPaperId((prev) => (prev === paper.paperId ? null : prev));
      }, 2000);
    } catch {
      // Clipboard fallback ignored safely
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10 space-y-8">
      {/* Page Header */}
      <header className="space-y-4 pb-6 border-b border-stone-200">
        <div className="min-w-0">
          <p className="text-xs font-medium text-stone-500 mb-1">
            Youth Guidance Research Intelligence · OpenAlex &amp; Crossref
          </p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            청소년지도 최신 연구동향
          </h1>
          <p className="text-sm text-stone-600 mt-1.5 max-w-3xl leading-relaxed">
            OpenAlex·Crossref 학술 데이터베이스에서 초기 5년(60개월) 및 정기 12개월·최근 3개월
            단위로 국내외 논문을 수집하고, Gemini AI가 6대 청소년지도 분야별로 분류·요약한
            연구정보 플랫폼입니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="inline-flex items-center p-1 bg-stone-100 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('papers')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'papers'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              연구동향 대시보드 · 논문
            </button>
            <button
              type="button"
              onClick={() => setViewMode('reports')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'reports'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <FileBarChart2 className="w-3.5 h-3.5" />
              월간 연구동향 보고서 ({monthlyReports.length})
            </button>
            <button
              type="button"
              onClick={() => setViewMode('dbpia')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'dbpia'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              실시간 DBpia 국내 검색
            </button>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleRunManualSync(3)}
                disabled={isSyncRunning}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${runningLookback === 3 || isSyncRunning ? 'animate-spin' : ''}`}
                />
                {runningLookback === 3
                  ? '3개월 수집·분석 중...'
                  : isSyncRunning
                    ? '수집 진행 중...'
                    : '최근 3개월 업데이트'}
              </button>
              <button
                type="button"
                onClick={() => handleRunManualSync(12)}
                disabled={isSyncRunning}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${runningLookback === 12 ? 'animate-spin' : ''}`}
                />
                {runningLookback === 12 ? '정기 12개월 수집 중...' : '정기 12개월 수집'}
              </button>
              <button
                type="button"
                onClick={() => handleRunManualSync(60)}
                disabled={isSyncRunning}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${runningLookback === 60 ? 'animate-spin' : ''}`}
                />
                {runningLookback === 60 ? '초기 5년 수집 중...' : '초기 5년(60개월) 수집'}
              </button>
              {pendingOrFailedPapers.length > 0 && (
                <button
                  type="button"
                  onClick={handleRunPendingAiAnalysis}
                  disabled={retryingAnalysis || isSyncRunning}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#002968] bg-[#F4F7FB] border border-[#D5DFEE] hover:bg-[#E9EFF8] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {retryingAnalysis
                    ? retryProgress
                      ? `AI 분석 복구 중 (${retryProgress.done}/${retryProgress.total})...`
                      : 'AI 분석 중...'
                    : `AI 분석 대기·실패 (${pendingOrFailedPapers.length}편) 실행`}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {(isAdmin || viewMode === 'dbpia' || (isLikelyStaticHosting() && !getActiveApiBaseUrl())) && (
        <CloudRunServerBar compact defaultExpanded={isLikelyStaticHosting() && !getActiveApiBaseUrl()} />
      )}

      {(isSyncRunning || retryingAnalysis || generatingReport) && (
        <div
          role="status"
          aria-live="polite"
          className="px-4 py-3 rounded-lg border border-[#D5DFEE] bg-[#F4F7FB] text-xs text-[#002968] flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
            <div className="min-w-0">
              <p className="font-semibold truncate">
                {retryingAnalysis
                  ? retryProgress
                    ? `Cloud Run Gemini AI 논문 분석 처리 중 (${retryProgress.done} / ${retryProgress.total}편)...`
                    : 'Cloud Run Gemini AI 논문 분석 처리 중...'
                  : generatingReport
                    ? 'Cloud Run Gemini AI 월간 연구동향 종합 보고서 작성 중...'
                    : syncProgressText ||
                      researchSyncStatus?.lastSyncMessage ||
                      '논문 수집 및 Gemini AI 분석을 진행하고 있습니다...'}
              </p>
              <p className="text-[11px] text-stone-600 mt-0.5">
                AI 분석이 완료되면 Firestore에 자동 반영되어 화면이 업데이트됩니다.
              </p>
            </div>
          </div>
          {retryingAnalysis && retryProgress && retryProgress.total > 0 && (
            <span className="font-mono font-semibold tabular-nums shrink-0">
              {Math.round((retryProgress.done / retryProgress.total) * 100)}%
            </span>
          )}
        </div>
      )}

      {actionBanner && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs font-medium flex items-start justify-between gap-3 ${
            actionBanner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span className="leading-relaxed">{actionBanner.text}</span>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            aria-label="알림 닫기"
            className="text-current opacity-70 hover:opacity-100 p-0.5 shrink-0 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* VIEW 1: DASHBOARD + PAPER SEARCH + CATEGORIZED LIST */}
      {viewMode === 'papers' && (
        <>
          {/* Section A: Research Dashboard */}
          <section aria-label="최신 연구동향 대시보드" className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">최근 1년 수집 논문</p>
                <p className="text-2xl font-bold text-stone-900 tabular-nums mt-1">
                  {dashboardStats.recent12MonthsCount}
                  <span className="text-xs font-normal text-stone-500 ml-1">편</span>
                </p>
                <p className="text-[11px] text-stone-500 mt-1 tabular-nums">
                  최근 3개월 {dashboardStats.recent3MonthsCount}편 · 누적 전체{' '}
                  {dashboardStats.totalCount}편
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">이번 달 신규 · AI 요약</p>
                <p className="text-2xl font-bold text-[#002968] tabular-nums mt-1">
                  {dashboardStats.monthlyNewCount}
                  <span className="text-xs font-normal text-stone-500 ml-1">
                    편 ({kstContext.currentMonthLabel})
                  </span>
                </p>
                <p className="text-[11px] text-stone-500 mt-1 tabular-nums">
                  AI 요약 완료 {dashboardStats.analyzedCount}편 · 오픈액세스{' '}
                  {dashboardStats.openAccessCount}편
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-stone-500">국내 · 해외 논문 비율</p>
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setRegionFilter(regionFilter === 'domestic' ? 'all' : 'domestic')
                      }
                      className={`cursor-pointer hover:underline ${
                        regionFilter === 'domestic'
                          ? 'font-bold text-[#002968]'
                          : 'text-stone-600'
                      }`}
                    >
                      국내만
                    </button>
                    <span className="text-stone-300" aria-hidden="true">
                      /
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setRegionFilter(
                          regionFilter === 'international' ? 'all' : 'international'
                        )
                      }
                      className={`cursor-pointer hover:underline ${
                        regionFilter === 'international'
                          ? 'font-bold text-[#002968]'
                          : 'text-stone-600'
                      }`}
                    >
                      해외만
                    </button>
                  </div>
                </div>
                <p className="text-base font-bold text-stone-900 tabular-nums">
                  국내 {dashboardStats.domesticCount} ({dashboardStats.domesticPct}%) · 해외{' '}
                  {dashboardStats.internationalCount} ({dashboardStats.internationalPct}%)
                </p>
                <div
                  className="w-full h-2 rounded-full bg-stone-200 overflow-hidden flex"
                  aria-label="국내 및 해외 논문 비율 막대"
                >
                  <div
                    className="h-full bg-[#002968] transition-all"
                    style={{ width: `${dashboardStats.domesticPct}%` }}
                  />
                  <div
                    className="h-full bg-stone-400 transition-all"
                    style={{ width: `${dashboardStats.internationalPct}%` }}
                  />
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">최근 업데이트 일자</p>
                <p className="text-sm font-bold text-stone-900 tabular-nums mt-1.5">
                  {researchSyncStatus?.lastSyncedAt
                    ? formatKoreanDateTime(researchSyncStatus.lastSyncedAt)
                    : '초기 수집 대기 중'}
                </p>
                <p className="text-[11px] text-stone-500 mt-1 truncate">
                  {researchSyncStatus?.windowLabel
                    ? `수집 범위: ${researchSyncStatus.windowLabel}`
                    : '매월 1일 03:00 (Asia/Seoul) 자동 갱신'}
                </p>
              </div>
            </div>

            {dashboardStats.yearBreakdown.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2.5 text-xs">
                <span className="font-semibold text-stone-700">연도별 발행 현황</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setYearFilter('all')}
                    className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      yearFilter === 'all'
                        ? 'bg-[#002968] text-white font-medium'
                        : 'text-stone-600 hover:bg-stone-100'
                    }`}
                  >
                    전체 ({dashboardStats.totalCount})
                  </button>
                  {dashboardStats.yearBreakdown.map(([yr, cnt]) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => setYearFilter(yearFilter === yr ? 'all' : yr)}
                      className={`px-2.5 py-1 rounded-md tabular-nums transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        yearFilter === yr
                          ? 'bg-[#002968] text-white font-medium'
                          : 'text-stone-700 bg-stone-50 hover:bg-stone-100'
                      }`}
                    >
                      {yr}년 ({cnt})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 6-Category Counts Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {YOUTH_RESEARCH_CATEGORIES.map((cat) => {
                const count = dashboardStats.categoryCounts[cat];
                const isSelected = selectedCategory === cat;
                const pct =
                  dashboardStats.totalCount > 0
                    ? Math.round((count / dashboardStats.totalCount) * 100)
                    : 0;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(isSelected ? '전체' : cat)}
                    className={`text-left rounded-lg border p-3.5 transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[#002968] bg-[#F4F7FB]'
                        : 'border-stone-200 bg-white hover:bg-[#F7F6F3]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`text-xs font-semibold truncate ${
                          isSelected ? 'text-[#002968]' : 'text-stone-800'
                        }`}
                      >
                        {cat}
                      </span>
                      <span className="text-xs font-bold tabular-nums text-stone-900 shrink-0">
                        {count}편 ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-stone-100 overflow-hidden">
                      <div
                        className="h-full bg-[#002968] rounded-full transition-all"
                        style={{ width: `${Math.max(pct, count > 0 ? 8 : 0)}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Domestic Indexing Disclaimer & Google Scholar External Reference */}
            <NotionCallout
              tone="neutral"
              icon={<Globe className="w-4 h-4" />}
              title="국내외 수집 범위 안내 및 구글 학술검색(Google Scholar) 외부 연계"
              action={
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <a
                    href={
                      selectedCategory === '전체'
                        ? 'https://scholar.google.co.kr/scholar?q=청소년지도'
                        : buildGoogleScholarCategoryUrl(selectedCategory)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-[#002968] hover:underline"
                  >
                    Google Scholar에서 직접 검색하기
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <a
                    href="https://scholar.google.com/scholar_alerts?view_op=list_alerts&hl=ko"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-stone-700 hover:text-stone-900 hover:underline"
                  >
                    <Bell className="w-3 h-3" />
                    Google Scholar 이메일 알림 설정
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => onNavigate('admin')}
                      className="font-medium text-stone-600 hover:text-stone-900 underline cursor-pointer"
                    >
                      관리자 수집 현황·오류 로그 보기
                    </button>
                  )}
                </div>
              }
            >
              <p className="text-xs text-stone-600 leading-relaxed">
                {researchSyncStatus?.koreanCoverageNotice ||
                  '본 플랫폼은 공개 학술 메타데이터 API(OpenAlex · Crossref)를 통해 최근 12개월 논문을 자동 수집합니다. 국내 학술지의 국제 데이터베이스 색인 시차로 일부 최신 국내 논문이 누락될 수 있으므로, 필요한 경우 아래 구글 학술검색 바로가기로 함께 확인하시기 바랍니다.'}
              </p>
            </NotionCallout>
          </section>

          {/* Section D: Search & Multi-Facet Filter Bar */}
          <section aria-label="논문 검색 및 필터" className="space-y-3 pt-2">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="논문 제목, 저자, 키워드, 학술지명, 요약 내용 검색..."
                  className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="연구 분야 선택"
                  value={selectedCategory}
                  onChange={(e) =>
                    setSelectedCategory(e.target.value as '전체' | YouthResearchCategory)
                  }
                  className="px-3 py-2 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-700"
                >
                  <option value="전체">전체 분야 (6대 영역)</option>
                  {YOUTH_RESEARCH_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="국내외 구분 선택"
                  value={regionFilter}
                  onChange={(e) =>
                    setRegionFilter(e.target.value as 'all' | 'domestic' | 'international')
                  }
                  className="px-3 py-2 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-700"
                >
                  <option value="all">국내 · 해외 전체</option>
                  <option value="domestic">국내 논문</option>
                  <option value="international">해외 논문</option>
                </select>

                <select
                  aria-label="수집 기간 선택"
                  value={periodFilter}
                  onChange={(e) =>
                    setPeriodFilter(e.target.value as 'all' | '3m' | '6m' | '12m' | '60m')
                  }
                  className="px-3 py-2 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-700"
                >
                  <option value="all">발행 기간 전체</option>
                  <option value="3m">최근 3개월</option>
                  <option value="6m">최근 6개월</option>
                  <option value="12m">최근 12개월</option>
                  <option value="60m">최근 5년 (60개월)</option>
                </select>

                <select
                  aria-label="발행연도 선택"
                  value={yearFilter}
                  onChange={(e) => setYearFilter(e.target.value)}
                  className="px-3 py-2 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-700 tabular-nums"
                >
                  <option value="all">발행연도 전체</option>
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {y}년
                    </option>
                  ))}
                </select>

                <select
                  aria-label="자료 상태 필터"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as 'all' | 'completed' | 'open_access')
                  }
                  className="px-3 py-2 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-700"
                >
                  <option value="all">분석·접근 전체</option>
                  <option value="completed">AI 요약 완료만</option>
                  <option value="open_access">오픈액세스만</option>
                </select>

                <select
                  aria-label="정렬 기준 선택"
                  value={sortOrder}
                  onChange={(e) =>
                    setSortOrder(e.target.value as 'newest' | 'oldest' | 'cited')
                  }
                  className="px-3 py-2 text-xs font-medium border border-stone-200 rounded-lg bg-white text-stone-700"
                >
                  <option value="newest">최신 발행순</option>
                  <option value="cited">피인용 많은순</option>
                  <option value="oldest">오래된 발행순</option>
                </select>
              </div>
            </div>

            {topKeywords.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-stone-500 mr-1">주요 키워드:</span>
                {topKeywords.map(({ kw, count }) => {
                  const isActive = searchQuery.trim().toLowerCase() === kw.toLowerCase();
                  return (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => setSearchQuery(isActive ? '' : kw)}
                      className={`px-2 py-1 rounded border text-[11px] transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isActive
                          ? 'bg-[#002968] text-white border-[#002968]'
                          : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300'
                      }`}
                    >
                      #{kw} ({count})
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>
                검색 결과 <strong className="text-stone-900 tabular-nums">{filteredPapers.length}</strong>편
                {selectedCategory !== '전체' && ` · 분야: ${selectedCategory}`}
                {regionFilter !== 'all' &&
                  ` · 구분: ${regionFilter === 'domestic' ? '국내' : '해외'}`}
                {statusFilter !== 'all' &&
                  ` · ${statusFilter === 'completed' ? 'AI 요약 완료' : '오픈액세스'}`}
                {periodFilter !== 'all' &&
                  ` · 기간: ${
                    periodFilter === '3m'
                      ? '최근 3개월'
                      : periodFilter === '6m'
                        ? '최근 6개월'
                        : periodFilter === '60m'
                          ? '최근 5년(60개월)'
                          : '최근 12개월'
                  }`}
              </span>
              {(selectedCategory !== '전체' ||
                regionFilter !== 'all' ||
                statusFilter !== 'all' ||
                periodFilter !== 'all' ||
                yearFilter !== 'all' ||
                sortOrder !== 'newest' ||
                searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('전체');
                    setRegionFilter('all');
                    setStatusFilter('all');
                    setPeriodFilter('all');
                    setYearFilter('all');
                    setSortOrder('newest');
                    setSearchQuery('');
                  }}
                  className="text-[#002968] hover:underline cursor-pointer"
                >
                  필터 초기화
                </button>
              )}
            </div>
          </section>

          {/* Section B: Categorized Paper List */}
          <section aria-label="분야별 논문 목록" className="space-y-3.5">
            {filteredPapers.length === 0 ? (
              <div className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-10 text-center space-y-3">
                <BookOpen className="w-8 h-8 text-stone-400 mx-auto" />
                {papers.length === 0 ? (
                  <>
                    <p className="text-sm font-semibold text-stone-800">
                      아직 수집된 논문이 없습니다
                    </p>
                    <p className="text-xs text-stone-600 max-w-md mx-auto leading-relaxed">
                      {isAdmin
                        ? '상단의 [최근 3개월 업데이트], [정기 12개월 수집] 또는 [초기 5년(60개월) 수집] 버튼을 누르시면 OpenAlex 및 Crossref에서 국내외 논문을 수집합니다.'
                        : '관리자가 OpenAlex·Crossref 논문 수집을 실행하면 이곳에 최신 연구동향이 표시됩니다.'}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-stone-600">
                    선택한 검색 조건에 해당하는 논문이 없습니다. 필터를 변경해 보세요.
                  </p>
                )}
              </div>
            ) : (
              filteredPapers.map((paper) => {
                const primaryUrl =
                  paper.paperUrl || (paper.doi ? `https://doi.org/${paper.doi}` : '');
                const scholarUrl = buildGoogleScholarPaperUrl(
                  paper.title,
                  paper.authors?.[0]
                );
                return (
                  <article
                    key={paper.paperId}
                    className="rounded-lg border border-stone-200 bg-white hover:border-stone-300 transition-colors p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
                        <span className="font-semibold text-[#002968]">{paper.mainCategory}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-stone-700">
                          {paper.region === 'domestic' ? '국내 논문' : '해외 논문'}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{paper.publicationDate}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[260px]">{paper.journalName}</span>
                        {paper.openAccess && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-emerald-700 font-medium">오픈액세스</span>
                          </>
                        )}
                      </div>

                      <span
                        className={`text-[11px] font-medium ${
                          paper.analysisStatus === 'pending'
                            ? 'text-amber-700'
                            : paper.analysisStatus === 'failed'
                              ? 'text-red-700'
                              : 'text-stone-500'
                        }`}
                      >
                        {paper.analysisStatus === 'pending'
                          ? 'AI 요약 대기 (서지·초록 수집됨)'
                          : paper.analysisStatus === 'failed'
                            ? 'AI 분석 오류'
                            : paper.analysisBasis}
                      </span>
                    </div>

                    <div>
                      <button
                        type="button"
                        onClick={() => setSelectedPaper(paper)}
                        className="text-left group cursor-pointer"
                      >
                        <h2 className="text-base sm:text-lg font-bold text-stone-900 group-hover:text-[#002968] leading-snug">
                          {paper.title}
                        </h2>
                      </button>
                      <p className="text-xs text-stone-600 mt-1">
                        저자: {(paper.authors || []).slice(0, 6).join(', ')}
                        {(paper.authors || []).length > 6 ? ' 외' : ''}
                      </p>
                    </div>

                    {(paper.easySummary || paper.abstract) && (
                      <p className="text-sm text-stone-700 leading-relaxed line-clamp-3">
                        {paper.easySummary || paper.abstract}
                      </p>
                    )}

                    {((paper.relatedCategories || []).length > 0 ||
                      (paper.keywords || []).length > 0) && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-500">
                        {(paper.relatedCategories || []).map((rel) => (
                          <span key={rel} className="text-[#002968] font-medium">
                            연관분야: {rel}
                          </span>
                        ))}
                        {(paper.relatedCategories || []).length > 0 &&
                          (paper.keywords || []).length > 0 && (
                            <span aria-hidden="true">·</span>
                          )}
                        {(paper.keywords || []).slice(0, 5).map((kw, kwIdx) => (
                          <React.Fragment key={kw}>
                            {kwIdx > 0 && <span aria-hidden="true">·</span>}
                            <span>#{kw}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    )}

                    <div className="pt-2 border-t border-stone-100 flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedPaper(paper)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#002968] hover:underline cursor-pointer"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        {paper.analysisStatus === 'completed'
                          ? 'AI 연구 요약 · 시사점 상세 보기'
                          : '서지 · 초록 상세 보기'}
                      </button>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {primaryUrl && (
                          <a
                            href={primaryUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-medium text-stone-700 hover:text-[#002968]"
                          >
                            {paper.doi ? `DOI (${paper.doi})` : '원문 링크'}
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <a
                          href={scholarUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-stone-600 hover:text-stone-900"
                        >
                          구글 학술검색
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </>
      )}

      {/* VIEW 2: MONTHLY TREND REPORTS (SECTION E) */}
      {viewMode === 'reports' && (
        <section aria-label="월간 연구동향 보고서" className="space-y-6">
          {monthlyReports.length === 0 ? (
            <div className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-10 text-center space-y-4">
              <FileBarChart2 className="w-8 h-8 text-stone-400 mx-auto" />
              <div className="space-y-1.5">
                <p className="text-sm font-semibold text-stone-800">
                  생성된 월간 연구동향 보고서가 아직 없습니다
                </p>
                <p className="text-xs text-stone-600 max-w-md mx-auto leading-relaxed">
                  매월 1일 오전 3시(Asia/Seoul) 정기 수집 후 자동 생성되며, 관리자는 수집된 논문을
                  바탕으로 즉시 보고서를 생성할 수 있습니다.
                </p>
              </div>
              {isAdmin && papers.length > 0 && (
                <div className="inline-flex flex-wrap items-center justify-center gap-2 pt-1">
                  <select
                    aria-label="보고서 생성 대상 범위"
                    value={reportScope}
                    onChange={(e) => setReportScope(e.target.value as MonthlyReportScope)}
                    className="px-3 py-2 text-xs font-medium border border-stone-300 rounded-lg bg-white text-stone-800"
                  >
                    <option value="all">대상: 누적 전체 논문 ({papers.length}편)</option>
                    <option value="12m">대상: 최근 12개월 논문</option>
                    <option value="3m">대상: 최근 3개월 논문</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleGenerateReportNow}
                    disabled={generatingReport}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {generatingReport ? '월간 보고서 생성 중...' : '수집 논문으로 월간 보고서 생성'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            activeReport &&
            (() => {
              const repTotal = Math.max(activeReport.totalPapersCount, 0);
              const repDomPct =
                repTotal > 0 ? Math.round((activeReport.domesticCount / repTotal) * 100) : 0;
              const repIntlPct = repTotal > 0 ? 100 - repDomPct : 0;
              const maxCategoryCount = Math.max(
                1,
                ...YOUTH_RESEARCH_CATEGORIES.map((c) => dashboardStats.categoryCounts[c] || 0)
              );
              const reportSections = [
                {
                  num: '01',
                  title: '월간 분야별 연구 흐름',
                  content: activeReport.categoryFlows,
                  accent: false,
                },
                {
                  num: '02',
                  title: '주목할 만한 논문',
                  content: activeReport.notablePapers,
                  accent: false,
                },
                {
                  num: '03',
                  title: '주요 연구 주제',
                  content: activeReport.keyThemes,
                  accent: false,
                },
                {
                  num: '04',
                  title: '공통적인 연구 결과',
                  content: activeReport.commonFindings,
                  accent: false,
                },
                {
                  num: '05',
                  title: '연구 공백 및 후속 연구 과제',
                  content: activeReport.researchGaps,
                  accent: false,
                },
                {
                  num: '06',
                  title: '청소년지도 현장에 대한 시사점',
                  content: activeReport.fieldImplications,
                  accent: true,
                },
              ];

              return (
                <div className="space-y-6">
                  {/* Archive Switcher when multiple monthly reports exist */}
                  {monthlyReports.length > 1 && (
                    <div className="flex flex-wrap items-center gap-2 pb-1 border-b border-stone-200 print:hidden">
                      <span className="text-[11px] font-medium text-stone-500 mr-1">
                        월별 아카이브:
                      </span>
                      {monthlyReports.map((r) => {
                        const isSelected = r.reportId === activeReport.reportId;
                        return (
                          <button
                            key={r.reportId}
                            type="button"
                            onClick={() => setSelectedReportId(r.reportId)}
                            className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              isSelected
                                ? 'bg-[#002968] text-white font-semibold'
                                : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                            }`}
                          >
                            {r.monthLabel}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Executive Header + Export / Regenerate Controls */}
                  <div className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-5 space-y-4">
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-stone-500">
                          <span>명지대학교 대학원 청소년지도학과 원우회</span>
                          <span aria-hidden="true">·</span>
                          <span>{activeReport.periodRange}</span>
                          {activeReport.updatedAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">
                                갱신 {formatKoreanDateTime(activeReport.updatedAt)}
                              </span>
                            </>
                          )}
                        </div>
                        <h2 className="font-serif text-xl sm:text-2xl font-bold text-stone-900">
                          {activeReport.monthLabel} 청소년지도 연구동향 종합 보고서
                        </h2>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0 print:hidden">
                        <button
                          type="button"
                          onClick={() => handleCopyReportMarkdown(activeReport)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          {copiedReportId === activeReport.reportId ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-700" />
                              복사됨
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              요약 복사
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDownloadReportMarkdown(activeReport)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Markdown 저장
                        </button>
                        <button
                          type="button"
                          onClick={handlePrintReport}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          인쇄
                        </button>

                        {isAdmin && (
                          <div className="inline-flex items-center gap-1.5 pl-1 border-l border-stone-300">
                            <select
                              aria-label="보고서 생성 대상 범위"
                              value={reportScope}
                              onChange={(e) =>
                                setReportScope(e.target.value as MonthlyReportScope)
                              }
                              className="px-2 py-1.5 text-xs font-medium border border-stone-300 rounded-md bg-white text-stone-800"
                            >
                              <option value="all">누적 전체</option>
                              <option value="12m">최근 12개월</option>
                              <option value="3m">최근 3개월</option>
                            </select>
                            <button
                              type="button"
                              onClick={handleGenerateReportNow}
                              disabled={generatingReport}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <RefreshCw
                                className={`w-3 h-3 ${generatingReport ? 'animate-spin' : ''}`}
                              />
                              {generatingReport ? '갱신 중...' : '보고서 다시 생성'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Report Executive KPI Strip */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
                        <p className="text-[11px] text-stone-500">분석 반영 논문</p>
                        <p className="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                          {activeReport.totalPapersCount}
                          <span className="text-xs font-normal text-stone-500 ml-1">편</span>
                        </p>
                      </div>
                      <div className="rounded-lg border border-stone-200 bg-white px-4 py-3">
                        <p className="text-[11px] text-stone-500">해당 월 신규 논문</p>
                        <p className="text-xl font-bold text-[#002968] tabular-nums mt-0.5">
                          {activeReport.newPapersCount}
                          <span className="text-xs font-normal text-stone-500 ml-1">편</span>
                        </p>
                      </div>
                      <div className="rounded-lg border border-stone-200 bg-white px-4 py-3 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-stone-500">
                          <span>국내 · 해외 논문 비중</span>
                          <span className="tabular-nums font-medium text-stone-700">
                            {repDomPct}% / {repIntlPct}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-stone-100 overflow-hidden flex">
                          <div
                            className="h-full bg-[#002968]"
                            style={{ width: `${repDomPct}%` }}
                            title={`국내 ${activeReport.domesticCount}편`}
                          />
                          <div
                            className="h-full bg-[#6482B0]"
                            style={{ width: `${repIntlPct}%` }}
                            title={`해외 ${activeReport.internationalCount}편`}
                          />
                        </div>
                        <p className="text-xs font-semibold text-stone-800 tabular-nums">
                          국내 {activeReport.domesticCount}편 · 해외{' '}
                          {activeReport.internationalCount}편
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Live 6-Category Distribution Bar Card (derived from collected papers) */}
                  {papers.length > 0 && (
                    <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-stone-900">
                            수집 논문 6대 청소년지도 분야별 분포 현황
                          </h3>
                          <p className="text-[11px] text-stone-500 mt-0.5">
                            분야 막대를 선택하면 해당 분야 논문 목록으로 바로 이동합니다.
                          </p>
                        </div>
                        <span className="text-xs font-mono text-stone-500 tabular-nums">
                          현재 DB {papers.length}편 기준
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2.5 pt-1">
                        {YOUTH_RESEARCH_CATEGORIES.map((cat) => {
                          const count = dashboardStats.categoryCounts[cat] || 0;
                          const pct = Math.round((count / maxCategoryCount) * 100);
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => {
                                setSelectedCategory(cat);
                                setViewMode('papers');
                              }}
                              className="text-left group cursor-pointer space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2 text-xs">
                                <span className="font-medium text-stone-800 group-hover:text-[#002968] group-hover:underline truncate">
                                  {cat}
                                </span>
                                <span className="font-mono font-semibold text-stone-700 tabular-nums shrink-0">
                                  {count}편
                                </span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-stone-100 overflow-hidden">
                                <div
                                  className="h-full bg-[#002968] group-hover:bg-[#001f4f] transition-all"
                                  style={{ width: `${count > 0 ? Math.max(pct, 6) : 0}%` }}
                                />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 6 Editorial Analysis Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {reportSections.map((sec) => (
                      <article
                        key={sec.num}
                        className={`rounded-lg border border-stone-200 p-5 space-y-2.5 ${
                          sec.accent ? 'bg-[#F4F7FB]' : 'bg-white'
                        }`}
                      >
                        <div className="flex items-baseline gap-2 border-b border-stone-200/70 pb-2">
                          <span className="font-mono text-xs font-bold text-[#002968] tabular-nums">
                            {sec.num}.
                          </span>
                          <h3 className="text-sm font-bold text-stone-900">{sec.title}</h3>
                        </div>
                        <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                          {sec.content}
                        </p>
                      </article>
                    ))}
                  </div>
                </div>
              );
            })()
          )}
        </section>
      )}

      {/* VIEW 3: REAL-TIME DBPIA DOMESTIC SEARCH (SEARCH-ONLY & LINK-OUT) */}
      {viewMode === 'dbpia' && (
        <section aria-label="실시간 DBpia 국내 논문 검색" className="space-y-5">
          <NotionCallout
            tone="navy"
            icon={<Info className="w-4 h-4" />}
            title="DBpia Open API 실시간 검색 · 원문 링크 연결 전용 (약관 준수)"
          >
            <p className="text-xs text-stone-700 leading-relaxed">
              DBpia Open API 이용 약관에 따라 검색 결과는 데이터베이스에 영구 저장되거나 AI 요약에
              활용되지 않으며, 실시간 서지 조회 및 DBpia 원문 페이지 직접 연결 용도로만 제공됩니다.
            </p>
          </NotionCallout>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleRunDbpiaSearch(undefined, 1);
            }}
            className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-4 space-y-3"
          >
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={dbpiaQuery}
                  onChange={(e) => setDbpiaQuery(e.target.value)}
                  placeholder="국내 논문 제목, 저자, 주제어 검색 (예: 청소년지도, 청소년 참여)"
                  className="w-full pl-9 pr-3 py-2 text-sm border border-stone-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
                />
              </div>
              <select
                aria-label="DBpia 정렬 방식"
                value={dbpiaSortType}
                onChange={(e) => setDbpiaSortType(e.target.value as '2' | '1')}
                className="px-3 py-2 text-xs font-medium border border-stone-300 rounded-lg bg-white text-stone-700"
              >
                <option value="2">최신 발행순</option>
                <option value="1">정확도순</option>
              </select>
              <button
                type="submit"
                disabled={dbpiaSearching}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Search className="w-3.5 h-3.5" />
                {dbpiaSearching ? '검색 중...' : 'DBpia 실시간 검색'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-stone-500 mr-1">추천 검색어:</span>
              {DBPIA_QUICK_KEYWORDS.map((kw) => (
                <button
                  key={kw}
                  type="button"
                  onClick={() => void handleRunDbpiaSearch(kw, 1)}
                  className={`px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                    dbpiaQuery === kw
                      ? 'bg-[#002968] text-white border-[#002968]'
                      : 'bg-white text-stone-700 border-stone-200 hover:border-stone-300'
                  }`}
                >
                  {kw}
                </button>
              ))}
            </div>
          </form>

          {dbpiaResult && (
            <div className="space-y-3">
              <div
                className={`rounded-lg border px-4 py-3 text-xs space-y-2 ${
                  dbpiaResult.ok
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : dbpiaResult.status === 'ready_needs_key'
                      ? 'bg-amber-50 border-amber-200 text-amber-950'
                      : 'bg-red-50 border-red-200 text-red-900'
                }`}
              >
                <p className="font-semibold">{dbpiaResult.message}</p>
                {dbpiaResult.status === 'ready_needs_key' && (
                  <div className="pt-1">
                    <a
                      href={`https://www.dbpia.co.kr/search/topSearch?searchOption=all&query=${encodeURIComponent(
                        dbpiaResult.query || dbpiaQuery
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#002968] hover:bg-[#001f4f] rounded-md"
                    >
                      DBpia 웹사이트에서 &ldquo;{dbpiaResult.query || dbpiaQuery}&rdquo; 직접 검색 열기
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {dbpiaResult.papers.length > 0 && (
                <div className="space-y-3">
                  {dbpiaResult.papers.map((item) => (
                    <article
                      key={item.sourceId}
                      className="rounded-lg border border-stone-200 bg-white hover:border-stone-300 p-4 space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-500">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-[#002968]">DBpia 국내 논문</span>
                          <span aria-hidden="true">·</span>
                          <span>{item.journalName}</span>
                          {item.publisherName && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{item.publisherName}</span>
                            </>
                          )}
                          {item.publicationDate && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="tabular-nums">{item.publicationDate}</span>
                            </>
                          )}
                        </div>
                        {item.freeYn === 'Y' && (
                          <span className="text-[11px] font-semibold text-emerald-700">
                            무료 열람 가능
                          </span>
                        )}
                      </div>

                      <h3 className="text-base font-bold text-stone-900 leading-snug">
                        {item.title}
                      </h3>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                        <span className="text-stone-600">
                          저자: {item.authors.join(', ')}
                          {item.pages ? ` · p.${item.pages}` : ''}
                        </span>
                        <a
                          href={item.paperUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-[#002968] hover:underline whitespace-nowrap shrink-0"
                        >
                          DBpia 원문 보기
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </article>
                  ))}

                  <div className="flex items-center justify-between pt-2 text-xs text-stone-600">
                    <span>
                      현재 {dbpiaPage}페이지 (전체 {dbpiaResult.totalCount.toLocaleString()}건)
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={dbpiaSearching || dbpiaPage <= 1}
                        onClick={() => void handleRunDbpiaSearch(undefined, dbpiaPage - 1)}
                        className="px-3 py-1 border border-stone-300 rounded bg-white hover:bg-stone-50 disabled:opacity-40 cursor-pointer"
                      >
                        이전
                      </button>
                      <button
                        type="button"
                        disabled={
                          dbpiaSearching || dbpiaPage * 10 >= dbpiaResult.totalCount
                        }
                        onClick={() => void handleRunDbpiaSearch(undefined, dbpiaPage + 1)}
                        className="px-3 py-1 border border-stone-300 rounded bg-white hover:bg-stone-50 disabled:opacity-40 cursor-pointer"
                      >
                        다음
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Section C: Detailed Paper AI Analysis Side-Peek Drawer */}
      <NotionSidePeekDrawer
        open={Boolean(selectedPaper)}
        onClose={() => setSelectedPaper(null)}
        breadcrumb={
          selectedPaper ? `청소년지도 연구동향 / ${selectedPaper.mainCategory}` : '연구동향'
        }
        headerActions={
          selectedPaper && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyCitation(selectedPaper)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md whitespace-nowrap cursor-pointer"
              >
                {copiedPaperId === selectedPaper.paperId ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-700" />
                    인용 복사됨
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    인용 형식 복사
                  </>
                )}
              </button>
              <a
                href={buildGoogleScholarPaperUrl(selectedPaper.title, selectedPaper.authors?.[0])}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md whitespace-nowrap"
              >
                Google Scholar
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )
        }
      >
        {selectedPaper && (
          <div className="space-y-6">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500 mb-2">
                <span className="font-semibold text-[#002968]">{selectedPaper.mainCategory}</span>
                <span aria-hidden="true">·</span>
                <span>{selectedPaper.region === 'domestic' ? '국내 논문' : '해외 논문'}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{selectedPaper.publicationDate}</span>
                <span aria-hidden="true">·</span>
                <span>{selectedPaper.journalName}</span>
              </div>

              <h2 className="font-serif text-xl sm:text-2xl font-bold text-stone-900 leading-snug mb-3">
                {selectedPaper.title}
              </h2>

              <p className="text-xs text-stone-600 mb-4">
                저자: {(selectedPaper.authors || []).join(', ')}
              </p>

              {/* Structured Bibliographic Metadata Grid */}
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2.5 rounded-lg border border-stone-200 bg-[#F7F6F3] p-3.5 text-xs mb-4">
                <div>
                  <dt className="text-[11px] text-stone-500">학술지 · 발행처</dt>
                  <dd className="font-medium text-stone-900 truncate" title={selectedPaper.journalName}>
                    {selectedPaper.journalName}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-stone-500">발행일 · 언어</dt>
                  <dd className="font-medium text-stone-900 tabular-nums">
                    {selectedPaper.publicationDate || '미상'} ({selectedPaper.language || 'ko'})
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-stone-500">수집 출처 · 피인용</dt>
                  <dd className="font-medium text-stone-900 tabular-nums">
                    {selectedPaper.source} · 인용 {selectedPaper.citedByCount ?? 0}회
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-stone-500">국내외 구분</dt>
                  <dd className="font-medium text-[#002968]">
                    {selectedPaper.region === 'domestic' ? '국내 논문' : '해외 논문'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-stone-500">오픈액세스</dt>
                  <dd className="font-medium text-stone-900">
                    {selectedPaper.openAccess ? '공개 열람 가능' : '초록/서지 공개'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-stone-500">DOI</dt>
                  <dd className="font-mono text-[11px] text-stone-800 truncate">
                    {selectedPaper.doi || '미제공'}
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {(selectedPaper.paperUrl || selectedPaper.doi) && (
                  <a
                    href={
                      selectedPaper.paperUrl ||
                      `https://doi.org/${selectedPaper.doi}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md"
                  >
                    논문 원문 · DOI 확인
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </a>
                )}
                <span className="inline-flex items-center gap-1 text-stone-500">
                  <Calendar className="w-3.5 h-3.5" />
                  분석 근거: {selectedPaper.analysisBasis}
                  {selectedPaper.aiAnalysisDate
                    ? ` · AI 분석일 ${selectedPaper.aiAnalysisDate}`
                    : ''}
                </span>
              </div>
            </div>

            {/* Strict AI Basis & Grounding Principle Notice */}
            <NotionCallout
              tone="navy"
              icon={<Info className="w-4 h-4" />}
              title={`분석 원칙: ${selectedPaper.analysisBasis}`}
            >
              <p className="text-xs text-stone-700 leading-relaxed">
                본 요약은 OpenAlex·Crossref에서 확인된 제목, 초록 및 서지정보만을 근거로
                작성되었습니다. 원문 전문에서 확인되지 않은 수치나 한계는 추정하지 않았으며,
                연구자가 보고한 결과와 AI의 현장·정책 해석을 구분하여 제시합니다.
              </p>
            </NotionCallout>

            {selectedPaper.analysisStatus === 'pending' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
                <p className="font-semibold">AI 상세 요약 대기 중 (서지정보 및 초록 수집 완료)</p>
                <p>
                  {selectedPaper.analysisError ||
                    '정적 호스팅(GitHub Pages) 환경에서 OpenAlex·Crossref 서지 및 초록이 먼저 저장되었습니다. AI Studio 서버 환경 또는 관리자 콘솔에서 [AI 분석 대기·실패 실행]을 누르면 Gemini AI 구조화 요약이 생성됩니다.'}
                </p>
              </div>
            ) : selectedPaper.analysisStatus === 'failed' ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-1">
                <p className="font-semibold">AI 상세 분석 오류</p>
                <p>
                  {selectedPaper.analysisError ||
                    'AI 분석 과정에서 오류가 발생했습니다. 관리자 콘솔에서 실패 논문을 재분석할 수 있습니다.'}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {selectedPaper.easySummary && (
                  <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4 space-y-1.5">
                    <h3 className="text-xs font-bold text-[#002968]">
                      01. 쉬운 언어로 작성한 연구 요약
                    </h3>
                    <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-line">
                      {selectedPaper.easySummary}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 text-sm">
                  {selectedPaper.researchPurpose && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-stone-900">02. 연구 목적</h3>
                      <p className="text-stone-700 leading-relaxed whitespace-pre-line">
                        {selectedPaper.researchPurpose}
                      </p>
                    </div>
                  )}
                  {selectedPaper.researchBackground && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-stone-900">연구 배경</h3>
                      <p className="text-stone-700 leading-relaxed whitespace-pre-line">
                        {selectedPaper.researchBackground}
                      </p>
                    </div>
                  )}
                  {selectedPaper.researchQuestion && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-stone-900">연구 질문</h3>
                      <p className="text-stone-700 leading-relaxed whitespace-pre-line">
                        {selectedPaper.researchQuestion}
                      </p>
                    </div>
                  )}
                  {(selectedPaper.researchMethod || selectedPaper.researchTarget) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-stone-100">
                      {selectedPaper.researchMethod && (
                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-stone-900">연구 방법</h3>
                          <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-line">
                            {selectedPaper.researchMethod}
                          </p>
                        </div>
                      )}
                      {selectedPaper.researchTarget && (
                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-stone-900">연구 대상</h3>
                          <p className="text-xs text-stone-700 leading-relaxed whitespace-pre-line">
                            {selectedPaper.researchTarget}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                  {selectedPaper.researchFindings && (
                    <div className="space-y-1 pt-2 border-t border-stone-100">
                      <h3 className="text-xs font-bold text-stone-900">
                        03. 주요 연구 결과 (연구자 보고 내용)
                      </h3>
                      <p className="text-stone-700 leading-relaxed whitespace-pre-line">
                        {selectedPaper.researchFindings}
                      </p>
                    </div>
                  )}
                  {selectedPaper.researchLimitations && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-stone-900">연구의 한계</h3>
                      <p className="text-xs text-stone-600 leading-relaxed whitespace-pre-line">
                        {selectedPaper.researchLimitations}
                      </p>
                    </div>
                  )}
                  {(selectedPaper.practicalImplications || selectedPaper.policyImplications) && (
                    <div className="rounded-lg border border-[#D5DFEE] bg-[#F4F7FB] p-4 space-y-3">
                      {selectedPaper.practicalImplications && (
                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-[#002968]">
                            04. 청소년지도 현장 시사점 (AI 실무 해석)
                          </h3>
                          <p className="text-xs text-stone-800 leading-relaxed whitespace-pre-line">
                            {selectedPaper.practicalImplications}
                          </p>
                        </div>
                      )}
                      {selectedPaper.policyImplications && (
                        <div className="space-y-1 pt-2 border-t border-[#D5DFEE]">
                          <h3 className="text-xs font-bold text-[#002968]">
                            정책 및 프로그램 개발 활용점 (AI 실무 해석)
                          </h3>
                          <p className="text-xs text-stone-800 leading-relaxed whitespace-pre-line">
                            {selectedPaper.policyImplications}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Keywords & Related Categories (Unboxed editorial typography) */}
            {((selectedPaper.relatedCategories || []).length > 0 ||
              (selectedPaper.keywords || []).length > 0) && (
              <div className="pt-3 border-t border-stone-200 space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                  <Tag className="w-3.5 h-3.5 text-[#002968]" />
                  연관 분야 및 핵심 키워드
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  {(selectedPaper.relatedCategories || []).map((rel, i) => (
                    <React.Fragment key={rel}>
                      {i > 0 && <span className="mx-1.5 text-stone-300">·</span>}
                      <span className="font-medium text-[#002968]">{rel}</span>
                    </React.Fragment>
                  ))}
                  {(selectedPaper.relatedCategories || []).length > 0 &&
                    (selectedPaper.keywords || []).length > 0 && (
                      <span className="mx-1.5 text-stone-300">·</span>
                    )}
                  {(selectedPaper.keywords || []).map((kw, i) => (
                    <React.Fragment key={kw}>
                      {i > 0 && <span className="mx-1.5 text-stone-300">·</span>}
                      <span>#{kw}</span>
                    </React.Fragment>
                  ))}
                </p>
              </div>
            )}

            {/* Original Abstract */}
            {selectedPaper.abstract && (
              <div className="pt-3 border-t border-stone-200 space-y-1.5">
                <h3 className="text-xs font-semibold text-stone-500">
                  05. 수집된 원문 초록 ({selectedPaper.source})
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed whitespace-pre-line bg-[#F7F6F3] p-3.5 rounded-lg border border-stone-200">
                  {selectedPaper.abstract}
                </p>
              </div>
            )}

            {/* Related Papers in Same Category */}
            {relatedPapersForDrawer.length > 0 && (
              <div className="pt-3 border-t border-stone-200 space-y-2">
                <h3 className="text-xs font-bold text-stone-900">
                  동일 분야 연관 논문 ({selectedPaper.mainCategory})
                </h3>
                <div className="divide-y divide-stone-100 border border-stone-200 rounded-lg bg-white">
                  {relatedPapersForDrawer.map((rel) => (
                    <button
                      key={rel.paperId}
                      type="button"
                      onClick={() => setSelectedPaper(rel)}
                      className="w-full text-left px-3.5 py-2.5 hover:bg-[#F7F6F3] transition-colors cursor-pointer"
                    >
                      <p className="text-xs font-semibold text-stone-900 line-clamp-1">
                        {rel.title}
                      </p>
                      <p className="text-[11px] text-stone-500 mt-0.5 truncate tabular-nums">
                        {rel.publicationDate} · {rel.journalName} ·{' '}
                        {rel.region === 'domestic' ? '국내' : '해외'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </NotionSidePeekDrawer>
    </div>
  );
}
