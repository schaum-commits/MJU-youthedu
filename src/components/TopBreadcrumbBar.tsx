import React from 'react';
import { Menu, MessageCircle, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_KAKAO_CHAT_URL, PageTab } from '../types/community';

const TAB_LABELS: Record<PageTab, string> = {
  home: '홈 · 원우회 소개',
  activities: '원우회 활동',
  board: '회원 전용 게시판',
  youthTrends: '청소년지도 연구동향',
  kakao: '카카오톡 라운지',
  directory: '원우 네트워크',
  admin: '관리자 콘솔',
};

export function TopBreadcrumbBar({
  activeTab,
  kakaoChatUrl = DEFAULT_KAKAO_CHAT_URL,
  onSelectTab,
  onOpenMobileSidebar,
  onOpenApplicationModal,
}: {
  activeTab: PageTab;
  kakaoChatUrl?: string;
  onSelectTab: (tab: PageTab) => void;
  onOpenMobileSidebar: () => void;
  onOpenApplicationModal: () => void;
}) {
  const { authUser, profile, isApprovedMember, loginWithGoogle } = useAuth();

  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-stone-200 px-4 sm:px-8 h-14 flex items-center justify-between gap-8">
      {/* Zone 1: Brand / Breadcrumb */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileSidebar}
          className="lg:hidden p-2 -ml-2 rounded-md text-stone-600 hover:bg-stone-100 cursor-pointer"
          aria-label="메뉴 열기"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab('home')}
            className="font-semibold text-stone-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            명지대 청소년지도학과 원우회
          </button>
          <span className="text-stone-400 shrink-0" aria-hidden="true">
            /
          </span>
          <span className="text-stone-600 truncate">{TAB_LABELS[activeTab]}</span>
        </div>
      </div>

      {/* Zone 2: Concise Text Nav Links on Desktop */}
      <nav
        className="hidden xl:flex items-center gap-6 text-sm font-medium text-stone-600"
        aria-label="빠른 이동"
      >
        <button
          type="button"
          onClick={() => onSelectTab('activities')}
          className={`whitespace-nowrap shrink-0 hover:text-stone-900 transition-colors cursor-pointer ${
            activeTab === 'activities' ? 'text-[#002968] underline underline-offset-4' : ''
          }`}
        >
          활동 소개
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('board')}
          className={`whitespace-nowrap shrink-0 hover:text-stone-900 transition-colors cursor-pointer ${
            activeTab === 'board' ? 'text-[#002968] underline underline-offset-4' : ''
          }`}
        >
          회원 게시판
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('youthTrends')}
          className={`whitespace-nowrap shrink-0 hover:text-stone-900 transition-colors cursor-pointer ${
            activeTab === 'youthTrends' ? 'text-[#002968] underline underline-offset-4' : ''
          }`}
        >
          청소년지도 연구동향
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('directory')}
          className={`whitespace-nowrap shrink-0 hover:text-stone-900 transition-colors cursor-pointer ${
            activeTab === 'directory' ? 'text-[#002968] underline underline-offset-4' : ''
          }`}
        >
          원우 네트워크
        </button>
      </nav>

      {/* Zone 3: Single Primary Action */}
      <div className="flex items-center shrink-0">
        {!authUser ? (
          <button
            type="button"
            onClick={loginWithGoogle}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogIn className="w-3.5 h-3.5" />
            원우 인증 로그인
          </button>
        ) : isApprovedMember ? (
          <a
            href={kakaoChatUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-stone-900 bg-[#FEE500] hover:bg-[#F5DC00] border border-[#E5CE00] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            카카오톡 채팅방
          </a>
        ) : (
          <button
            type="button"
            onClick={onOpenApplicationModal}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {profile ? '가입 신청 확인' : '원우 가입 신청'}
          </button>
        )}
      </div>
    </header>
  );
}
