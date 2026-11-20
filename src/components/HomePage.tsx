import React from 'react';
import {
  ArrowRight,
  CalendarDays,
  FileText,
  GraduationCap,
  Lock,
  MessageCircle,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_PUBLIC_SETTINGS } from '../lib/seedData';
import {
  COVER_IMAGE_URL,
  CouncilActivity,
  formatAdmissionTerm,
  PageTab,
  PublicSettings,
} from '../types/community';
import { NotionCallout, ResilientImage } from './NotionPrimitives';

export function HomePage({
  publicSettings,
  activities,
  pendingMemberCount = 0,
  onNavigate,
  onOpenActivity,
  onOpenApplicationModal,
}: {
  publicSettings: PublicSettings | null;
  activities: CouncilActivity[];
  pendingMemberCount?: number;
  onNavigate: (tab: PageTab) => void;
  onOpenActivity: (activity: CouncilActivity) => void;
  onOpenApplicationModal: () => void;
}) {
  const { authUser, profile, isApprovedMember, isAdmin, loginWithGoogle } = useAuth();

  const settings = publicSettings || DEFAULT_PUBLIC_SETTINGS;
  const previewActivities = activities.slice(0, 3);

  return (
    <div className="pb-20">
      {/* Notion Cover Banner */}
      <div className="relative w-full h-44 sm:h-60 bg-stone-100 border-b border-stone-200 overflow-hidden">
        <ResilientImage
          src={settings.coverImageUrl || COVER_IMAGE_URL}
          alt="명지대학교 인문캠퍼스 방목학술정보관 전경"
          className="w-full h-full object-cover"
          fallbackTitle="명지대학교 대학원 청소년지도학과 원우회"
        />
        <div
          className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent"
          aria-hidden="true"
        />
      </div>

      {/* Notion Page Body Container */}
      <div className="max-w-4xl mx-auto px-5 sm:px-10">
        {/* Overlapping Notion Page Icon */}
        <div className="-mt-9 relative z-10 mb-5 flex items-end justify-between gap-4">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-white border border-stone-200 shadow-sm flex items-center justify-center text-[#002968]">
            <GraduationCap className="w-9 h-9 sm:w-10 sm:h-10" strokeWidth={1.6} />
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              홈 소개 · 콘텐츠 편집
            </button>
          )}
        </div>

        {/* Page Title & Unboxed Metadata */}
        <header className="mb-8 pb-6 border-b border-stone-200">
          {settings.semesterLabel.replace(/제18대\s*원우회\s*·?\s*/g, '').trim() && (
            <p className="text-xs font-medium text-stone-500 mb-2">
              {settings.semesterLabel.replace(/제18대\s*원우회\s*·?\s*/g, '').trim()}
            </p>
          )}
          <h1 className="font-serif text-2xl sm:text-4xl font-bold text-stone-900 tracking-tight leading-snug mb-3">
            {settings.councilName}
          </h1>
          <p className="text-base sm:text-lg font-medium text-[#002968] mb-3">
            {settings.welcomeHeadline}
          </p>
          <p className="text-sm sm:text-base text-stone-700 leading-relaxed max-w-3xl">
            {settings.welcomeSummary}
          </p>
        </header>

        {/* Executive Notice Callout + Membership Action */}
        <section className="mb-10">
          <NotionCallout
            icon={<Sparkles className="w-5 h-5" />}
            title={
              !authUser
                ? '원우회 회원 가입 및 관리자 인증 안내'
                : !profile
                  ? '회원 가입 신청서 작성 필요'
                  : isApprovedMember
                    ? '원우회 안내 및 회원 인증 완료'
                    : profile.status === 'pending'
                      ? '관리자 회원 인증 대기 중'
                      : '회원 인증 보류 · 비활성화 안내'
            }
            tone={profile && profile.status !== 'approved' ? 'amber' : 'navy'}
            action={
              <div className="flex flex-wrap items-center gap-2.5">
                {!authUser ? (
                  <button
                    type="button"
                    onClick={loginWithGoogle}
                    className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    회원 가입 신청하기 (Google 로그인)
                  </button>
                ) : !profile ? (
                  <button
                    type="button"
                    onClick={onOpenApplicationModal}
                    className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    원우회 회원 가입 신청서 작성하기
                  </button>
                ) : isApprovedMember ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onNavigate('board')}
                      className="px-4 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      회원 전용 게시판 바로가기
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigate('kakao')}
                      className="px-4 py-2 text-xs font-medium text-stone-900 bg-[#FEE500] hover:bg-[#F5DC00] border border-[#E5CE00] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      카카오톡 오픈채팅 연결
                    </button>
                    {isAdmin && pendingMemberCount > 0 && (
                      <button
                        type="button"
                        onClick={() => onNavigate('admin')}
                        className="px-4 py-2 text-xs font-medium text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        인증 대기 원우 {pendingMemberCount}명 확인하기
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={onOpenApplicationModal}
                    className="px-4 py-2 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    신청 정보 확인 및 수정
                  </button>
                )}
              </div>
            }
          >
            {!authUser ? (
              <div className="space-y-1.5">
                <p>
                  {settings.executiveNotice ||
                    '원우회 회원 가입 신청 후 관리자의 회원 인증이 완료되면 게시판, 원우 네트워크, 카카오톡 오픈채팅방 링크를 모두 이용하실 수 있습니다.'}
                </p>
                <p className="text-xs text-stone-600">
                  가입 절차: Google 계정 로그인 → 회원 가입 신청서(성명·학번·입학년도/학기) 제출 → 원우회 관리자 확인 후 회원 인증 완료
                </p>
              </div>
            ) : !profile ? (
              <p>
                Google 계정({authUser.email}) 로그인이 완료되었습니다. 아래 버튼을 눌러 회원 가입 신청서를 제출하시면 원우회 관리자가 확인 후 회원 인증을 완료해 드립니다.
              </p>
            ) : profile.status === 'pending' ? (
              <div className="space-y-1">
                <p className="font-medium text-stone-900">
                  {profile.displayName} 원우님 ({formatAdmissionTerm(profile.cohort)} · {profile.program})의 회원 가입 신청이 접수되었습니다.
                </p>
                <p className="text-xs text-stone-600">
                  원우회 관리자가 학번과 원우 여부를 확인하여 회원 인증을 완료하면 회원 전용 게시판, 연구 동향, 카카오톡 오픈채팅방이 즉시 열립니다.
                </p>
              </div>
            ) : !isApprovedMember ? (
              <p>
                현재 계정은 관리자 확인 결과 인증이 보류되었거나 비활성화 상태입니다. 신청 정보를 수정하시거나 원우회 임원진에게 문의해 주세요.
              </p>
            ) : (
              <div className="space-y-1">
                <p>
                  {settings.executiveNotice ||
                    '원우회 회원 인증이 완료되어 모든 회원 전용 공간을 이용하실 수 있습니다.'}
                </p>
                <p className="text-xs text-stone-600">
                  인증 완료 회원: {profile?.displayName || authUser.displayName || '원우회 관리자'} ·{' '}
                  {isAdmin
                    ? '원우회 웹 관리자'
                    : `${formatAdmissionTerm(profile?.cohort)} ${profile?.program ?? ''}`.trim()}
                </p>
              </div>
            )}
          </NotionCallout>
        </section>

        {/* Notion Workspace Quick Database Grid */}
        <section className="mb-12">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-bold text-stone-900">01. 원우회 주요 워크스페이스</h2>
            <span className="text-xs text-stone-500">페이지 바로가기</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <button
              type="button"
              onClick={() => onNavigate('activities')}
              className="group text-left rounded-lg border border-stone-200 bg-white hover:bg-[#F7F6F3] p-4 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <CalendarDays className="w-4 h-4 text-[#002968]" />
                  원우회 활동 & 학사 일정
                </span>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                학술 콜로퀴엄, 신입생 오리엔테이션, 청소년 현장 기관 탐방 기록을 확인합니다.
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('board')}
              className="group text-left rounded-lg border border-stone-200 bg-white hover:bg-[#F7F6F3] p-4 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <FileText className="w-4 h-4 text-[#002968]" />
                  회원 전용 게시판
                </span>
                {isApprovedMember ? (
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-0.5 transition-transform" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-stone-400" />
                )}
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                승인된 원우회원만 접근 가능한 공지사항, 비공개 스터디 모집, 학사 Q&A 공간입니다.
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('youthTrends')}
              className="group text-left rounded-lg border border-stone-200 bg-white hover:bg-[#F7F6F3] p-4 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <Sparkles className="w-4 h-4 text-[#002968]" />
                  청소년지도 최신 연구동향
                </span>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                OpenAlex·Crossref 6대 분야 논문 수집과 원문 초록, 키워드, 실시간 DBpia 국내 검색을 제공합니다.
              </p>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('kakao')}
              className="group text-left rounded-lg border border-stone-200 bg-white hover:bg-[#F7F6F3] p-4 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-stone-900">
                  <MessageCircle className="w-4 h-4 text-[#002968]" />
                  카카오톡 오픈채팅 라운지
                </span>
                {isApprovedMember ? (
                  <ArrowRight className="w-4 h-4 text-stone-400 group-hover:translate-x-0.5 transition-transform" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-stone-400" />
                )}
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                실시간 대화를 위한 원우회 공식 카카오톡 오픈채팅 링크와 참여코드를 안내합니다.
              </p>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('youthTrends')}
              className="group text-left rounded-lg border border-[#D5DFEE] bg-[#F4F7FB] hover:bg-[#EAF0F8] p-4 transition-colors sm:col-span-2 cursor-pointer"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-[#002968]">
                  <Sparkles className="w-4 h-4 text-[#002968]" />
                  청소년지도 최신 연구동향 (OpenAlex · Crossref · DBpia 검색)
                </span>
                <ArrowRight className="w-4 h-4 text-[#002968] group-hover:translate-x-0.5 transition-transform" />
              </div>
              <p className="text-xs text-stone-700 leading-relaxed">
                OpenAlex·Crossref 6대 분야 국내외 논문 자동 수집, 원문 초록·키워드·인용 복사·DOI/Google Scholar 링크 및 실시간 DBpia 국내 검색을 누구나 열람할 수 있습니다.
              </p>
            </button>
          </div>
        </section>

        {/* Recent Activities Preview */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-bold text-stone-900">02. 최근 원우회 주요 활동</h2>
            <button
              type="button"
              onClick={() => onNavigate('activities')}
              className="text-xs font-medium text-[#002968] hover:underline cursor-pointer"
            >
              전체 활동 보기
            </button>
          </div>

          {previewActivities.length === 0 ? (
            <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-8 text-center">
              <p className="text-sm text-stone-600">
                등록된 원우회 활동이 아직 없습니다. 관리자가 활동 소식을 등록하면 이곳에 표시됩니다.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {previewActivities.map((act) => (
                <article
                  key={act.id}
                  onClick={() => onOpenActivity(act)}
                  className="group rounded-lg border border-stone-200 bg-white overflow-hidden hover:border-stone-300 transition-colors cursor-pointer flex flex-col"
                >
                  <div className="aspect-[4/3] w-full bg-stone-100 overflow-hidden border-b border-stone-100">
                    <ResilientImage
                      src={act.imageUrl}
                      alt={act.title}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                      fallbackTitle={act.title}
                    />
                  </div>
                  <div className="p-4 flex-1 flex flex-col">
                    <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-1.5 tabular-nums">
                      <span>{act.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{act.eventDate}</span>
                    </div>
                    <h3 className="text-sm font-bold text-stone-900 leading-snug mb-2 line-clamp-2 group-hover:text-[#002968]">
                      {act.title}
                    </h3>
                    <p className="text-xs text-stone-600 leading-relaxed line-clamp-2 mt-auto">
                      {act.summary}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
