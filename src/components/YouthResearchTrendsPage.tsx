import React, { useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Calendar,
  ExternalLink,
  FileBarChart2,
  Globe,
  Info,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  buildGoogleScholarCategoryUrl,
  buildGoogleScholarPaperUrl,
  collectAndAnalyzePapers,
  generateMonthlyTrendReport,
  getKstScheduleContext,
} from '../lib/youthPaperSync';
import {
  MonthlyTrendReport,
  PageTab,
  PaperRecord,
  ResearchSyncStatus,
  YOUTH_RESEARCH_CATEGORIES,
  YouthResearchCategory,
} from '../types/community';
import {
  formatKoreanDateTime,
  NotionCallout,
  NotionSidePeekDrawer,
} from './NotionPrimitives';

type SubViewMode = 'papers' | 'reports';

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
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPaper, setSelectedPaper] = useState<PaperRecord | null>(null);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [manualSyncRunning, setManualSyncRunning] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [actionBanner, setActionBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const kstContext = useMemo(() => getKstScheduleContext(), []);

  // Dashboard metrics calculated directly from collected papers
  const dashboardStats = useMemo(() => {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoffIso = oneYearAgo.toISOString().slice(0, 10);

    const recent12MonthsPapers = papers.filter((p) => (p.publicationDate || '') >= cutoffIso);
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

    return {
      totalCount: papers.length,
      recent12MonthsCount: recent12MonthsPapers.length,
      monthlyNewCount,
      domesticCount,
      internationalCount,
      domesticPct,
      internationalPct,
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

  const filteredPapers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return papers.filter((p) => {
      if (selectedCategory !== '전체') {
        const matchesMain = p.mainCategory === selectedCategory;
        const matchesRelated = (p.relatedCategories || []).includes(selectedCategory);
        if (!matchesMain && !matchesRelated) return false;
      }
      if (regionFilter !== 'all' && p.region !== regionFilter) return false;
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
          p.mainCategory,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [papers, selectedCategory, regionFilter, yearFilter, searchQuery]);

  const activeReport = useMemo(() => {
    if (monthlyReports.length === 0) return null;
    if (selectedReportId) {
      return monthlyReports.find((r) => r.reportId === selectedReportId) || monthlyReports[0];
    }
    return monthlyReports[0];
  }, [monthlyReports, selectedReportId]);

  const handleRunManualSync = async () => {
    if (!authUser || manualSyncRunning) return;
    setManualSyncRunning(true);
    setActionBanner(null);
    try {
      const result = await collectAndAnalyzePapers({
        triggerType: 'manual',
        authUser,
        actorName: profile?.displayName || authUser.displayName || '원우회 관리자',
        existingPapers: papers,
        autoEnabled: researchSyncStatus?.autoEnabled ?? true,
        currentStatus: researchSyncStatus,
        perCategoryLimit: 3,
        generateReportToo: true,
      });
      setActionBanner({
        type: result.ok ? 'ok' : 'err',
        text: result.message,
      });
    } finally {
      setManualSyncRunning(false);
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
      });
      setActionBanner({
        type: res.ok ? 'ok' : 'err',
        text: res.message,
      });
    } finally {
      setGeneratingReport(false);
    }
  };

  const isSyncRunning =
    manualSyncRunning || researchSyncStatus?.lastSyncStatus === 'syncing';

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10 space-y-8">
      {/* Page Header */}
      <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-6 border-b border-stone-200">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">
            Youth Guidance Research Intelligence · OpenAlex &amp; Crossref
          </p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            청소년지도 최신 연구동향
          </h1>
          <p className="text-sm text-stone-600 mt-1.5 max-w-2xl leading-relaxed">
            OpenAlex·Crossref 학술 데이터베이스에서 최근 12개월 국내외 논문을 자동 수집하고, Gemini
            AI가 6대 청소년지도 분야별로 분류·요약한 연구정보 플랫폼입니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={handleRunManualSync}
              disabled={isSyncRunning}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncRunning ? 'animate-spin' : ''}`} />
              {isSyncRunning ? '수집·AI 분석 중...' : '최신 논문 수집·분석'}
            </button>
          )}
        </div>
      </header>

      {actionBanner && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs font-medium ${
            actionBanner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {actionBanner.text}
        </div>
      )}

      {/* VIEW 1: DASHBOARD + PAPER SEARCH + CATEGORIZED LIST */}
      {viewMode === 'papers' && (
        <>
          {/* Section A: Research Dashboard */}
          <section aria-label="최신 연구동향 대시보드" className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">최근 1년 수집 논문</p>
                <p className="text-2xl font-bold text-stone-900 tabular-nums mt-1">
                  {dashboardStats.recent12MonthsCount}
                  <span className="text-xs font-normal text-stone-500 ml-1">
                    편 (전체 {dashboardStats.totalCount}편)
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">이번 달 신규 수집</p>
                <p className="text-2xl font-bold text-[#002968] tabular-nums mt-1">
                  {dashboardStats.monthlyNewCount}
                  <span className="text-xs font-normal text-stone-500 ml-1">
                    편 ({kstContext.currentMonthLabel})
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">국내 · 해외 논문 비율</p>
                <p className="text-lg font-bold text-stone-900 tabular-nums mt-1.5">
                  국내 {dashboardStats.domesticCount} ({dashboardStats.domesticPct}%) · 해외{' '}
                  {dashboardStats.internationalCount} ({dashboardStats.internationalPct}%)
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                <p className="text-xs text-stone-500">최근 업데이트 일자</p>
                <p className="text-sm font-bold text-stone-900 tabular-nums mt-1.5">
                  {researchSyncStatus?.lastSyncedAt
                    ? formatKoreanDateTime(researchSyncStatus.lastSyncedAt)
                    : '초기 수집 대기 중'}
                </p>
                <p className="text-[11px] text-stone-500 mt-0.5 truncate">
                  매월 1일 03:00 (Asia/Seoul) 자동 갱신
                </p>
              </div>
            </div>

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
                        {count}편
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
              </div>
            </div>

            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>
                검색 결과 <strong className="text-stone-900 tabular-nums">{filteredPapers.length}</strong>편
                {selectedCategory !== '전체' && ` · 분야: ${selectedCategory}`}
              </span>
              {(selectedCategory !== '전체' ||
                regionFilter !== 'all' ||
                yearFilter !== 'all' ||
                searchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory('전체');
                    setRegionFilter('all');
                    setYearFilter('all');
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
                        ? '상단의 [최신 논문 수집·분석] 버튼을 누르시면 OpenAlex 및 Crossref에서 최근 12개월 논문을 수집하여 Gemini AI로 자동 분류·요약합니다.'
                        : '관리자가 OpenAlex·Crossref 월간 논문 수집을 실행하면 이곳에 최신 연구동향이 표시됩니다.'}
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

                      <span className="text-[11px] text-stone-500">
                        {paper.analysisBasis}
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
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-600">
                        {(paper.relatedCategories || []).map((rel) => (
                          <span
                            key={rel}
                            className="px-2 py-0.5 rounded bg-[#F4F7FB] text-[#002968] font-medium"
                          >
                            연관: {rel}
                          </span>
                        ))}
                        {(paper.keywords || []).slice(0, 5).map((kw) => (
                          <span key={kw} className="px-2 py-0.5 rounded bg-[#F7F6F3] text-stone-600">
                            #{kw}
                          </span>
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
                        AI 연구 요약 · 시사점 상세 보기
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
            <div className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-10 text-center space-y-3">
              <FileBarChart2 className="w-8 h-8 text-stone-400 mx-auto" />
              <p className="text-sm font-semibold text-stone-800">
                생성된 월간 연구동향 보고서가 아직 없습니다
              </p>
              <p className="text-xs text-stone-600 max-w-md mx-auto leading-relaxed">
                매월 1일 오전 3시(Asia/Seoul) 정기 수집 후 자동 생성되며, 관리자는 수집된 논문을
                바탕으로 즉시 보고서를 생성할 수 있습니다.
              </p>
              {isAdmin && papers.length > 0 && (
                <button
                  type="button"
                  onClick={handleGenerateReportNow}
                  disabled={generatingReport}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {generatingReport ? '월간 보고서 생성 중...' : '수집 논문으로 월간 보고서 생성'}
                </button>
              )}
            </div>
          ) : (
            activeReport && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-stone-200 bg-[#F7F6F3] p-4">
                  <div>
                    <p className="text-xs text-stone-500">{activeReport.periodRange}</p>
                    <h2 className="font-serif text-xl font-bold text-stone-900 mt-0.5">
                      {activeReport.monthLabel} 청소년지도 연구동향 종합 보고서
                    </h2>
                    <p className="text-xs text-stone-600 mt-1 tabular-nums">
                      총 {activeReport.totalPapersCount}편 분석 · 신규{' '}
                      {activeReport.newPapersCount}편 · 국내 {activeReport.domesticCount}편 / 해외{' '}
                      {activeReport.internationalCount}편
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="보고서 월 선택"
                      value={activeReport.reportId}
                      onChange={(e) => setSelectedReportId(e.target.value)}
                      className="px-3 py-1.5 text-xs font-medium border border-stone-300 rounded-md bg-white"
                    >
                      {monthlyReports.map((r) => (
                        <option key={r.reportId} value={r.reportId}>
                          {r.monthLabel}
                        </option>
                      ))}
                    </select>
                    {isAdmin && (
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
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
                    <h3 className="text-sm font-bold text-[#002968]">1. 월간 분야별 연구 흐름</h3>
                    <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                      {activeReport.categoryFlows}
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
                    <h3 className="text-sm font-bold text-[#002968]">2. 주목할 만한 논문</h3>
                    <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                      {activeReport.notablePapers}
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
                    <h3 className="text-sm font-bold text-[#002968]">3. 주요 연구 주제</h3>
                    <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                      {activeReport.keyThemes}
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
                    <h3 className="text-sm font-bold text-[#002968]">4. 공통적인 연구 결과</h3>
                    <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                      {activeReport.commonFindings}
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
                    <h3 className="text-sm font-bold text-[#002968]">
                      5. 연구 공백 및 후속 연구 과제
                    </h3>
                    <p className="text-sm text-stone-700 leading-relaxed whitespace-pre-line">
                      {activeReport.researchGaps}
                    </p>
                  </div>
                  <div className="rounded-lg border border-stone-200 bg-[#F4F7FB] p-5 space-y-2">
                    <h3 className="text-sm font-bold text-[#002968]">
                      6. 청소년지도 현장에 대한 시사점
                    </h3>
                    <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-line">
                      {activeReport.fieldImplications}
                    </p>
                  </div>
                </div>
              </div>
            )
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
            <a
              href={buildGoogleScholarPaperUrl(selectedPaper.title, selectedPaper.authors?.[0])}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md whitespace-nowrap"
            >
              Google Scholar
              <ExternalLink className="w-3 h-3" />
            </a>
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

              <p className="text-xs text-stone-600 mb-3">
                저자: {(selectedPaper.authors || []).join(', ')}
              </p>

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
                  출처: {selectedPaper.source}
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
              title={`분석 근거: ${selectedPaper.analysisBasis}`}
            >
              <p className="text-xs text-stone-700 leading-relaxed">
                본 요약은 OpenAlex·Crossref에서 확인된 제목, 초록 및 서지정보만을 근거로
                작성되었습니다. 원문 전문에서 확인되지 않은 수치나 한계는 추정하지 않았으며,
                연구자가 보고한 결과와 AI의 현장·정책 해석을 구분하여 제시합니다.
              </p>
            </NotionCallout>

            {selectedPaper.analysisStatus === 'failed' ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-1">
                <p className="font-semibold">AI 상세 분석 대기/실패 상태</p>
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
                      쉬운 언어로 작성한 연구 요약
                    </h3>
                    <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-line">
                      {selectedPaper.easySummary}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 text-sm">
                  {selectedPaper.researchPurpose && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-bold text-stone-900">연구 목적</h3>
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
                        주요 연구 결과 (연구자 보고 내용)
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
                            청소년지도 현장 시사점 (AI 실무 해석)
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

            {/* Keywords & Related Categories */}
            {((selectedPaper.relatedCategories || []).length > 0 ||
              (selectedPaper.keywords || []).length > 0) && (
              <div className="pt-3 border-t border-stone-200 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-stone-700">
                  <Tag className="w-3.5 h-3.5 text-[#002968]" />
                  연관 분야 및 핵심 키워드
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {(selectedPaper.relatedCategories || []).map((rel) => (
                    <span
                      key={rel}
                      className="px-2 py-0.5 rounded bg-[#F4F7FB] text-[#002968] font-medium"
                    >
                      {rel}
                    </span>
                  ))}
                  {(selectedPaper.keywords || []).map((kw) => (
                    <span key={kw} className="px-2 py-0.5 rounded bg-stone-100 text-stone-700">
                      #{kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Original Abstract */}
            {selectedPaper.abstract && (
              <div className="pt-3 border-t border-stone-200 space-y-1.5">
                <h3 className="text-xs font-semibold text-stone-500">
                  수집된 원문 초록 ({selectedPaper.source})
                </h3>
                <p className="text-xs text-stone-600 leading-relaxed whitespace-pre-line bg-[#F7F6F3] p-3.5 rounded-lg border border-stone-200">
                  {selectedPaper.abstract}
                </p>
              </div>
            )}
          </div>
        )}
      </NotionSidePeekDrawer>
    </div>
  );
}
