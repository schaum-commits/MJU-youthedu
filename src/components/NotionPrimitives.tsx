import React, { useEffect, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { BookOpen, Lock, ShieldAlert, X } from 'lucide-react';
import { PageTab } from '../types/community';
import { useAuth } from '../contexts/AuthContext';

export function formatKoreanDate(ts?: Timestamp | null): string {
  if (!ts || typeof ts.toDate !== 'function') return '방금 전';
  const date = ts.toDate();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

export function formatKoreanDateTime(ts?: Timestamp | null): string {
  if (!ts || typeof ts.toDate !== 'function') return '방금 전';
  const date = ts.toDate();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}.${m}.${d} ${hh}:${mm}`;
}

export function resolveAssetUrl(src?: string): string | undefined {
  if (!src) return src;
  if (src.startsWith('/src/assets/')) {
    return `.${src}`;
  }
  return src;
}

export function ResilientImage({
  src,
  alt,
  className = '',
  fallbackTitle,
}: {
  src?: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}) {
  const resolvedSrc = resolveAssetUrl(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  if (!resolvedSrc || failed) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-slate-100 text-stone-500 border border-stone-200 ${className}`}
        role="img"
        aria-label={alt}
      >
        <BookOpen className="w-7 h-7 text-[#002968]/50 mb-2" strokeWidth={1.5} />
        {fallbackTitle && (
          <span className="text-xs font-medium text-stone-600 px-4 text-center line-clamp-2">
            {fallbackTitle}
          </span>
        )}
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}

/**
 * Notion-style neutral Callout block without thick left accent stripes.
 */
export function NotionCallout({
  icon,
  title,
  children,
  tone = 'neutral',
  action,
}: {
  icon: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  tone?: 'neutral' | 'navy' | 'amber';
  action?: React.ReactNode;
}) {
  const toneClasses =
    tone === 'navy'
      ? 'bg-[#F4F7FB] border-[#D5DFEE] text-stone-800'
      : tone === 'amber'
        ? 'bg-[#FBF8F1] border-[#E8DEC8] text-stone-800'
        : 'bg-[#F7F6F3] border-stone-200 text-stone-800';

  return (
    <div className={`rounded-lg border p-4 sm:p-5 ${toneClasses}`}>
      <div className="flex items-start gap-3.5">
        <div className="shrink-0 mt-0.5 text-[#002968]">{icon}</div>
        <div className="flex-1 min-w-0">
          {title && <p className="text-sm font-semibold text-stone-900 mb-1">{title}</p>}
          <div className="text-sm text-stone-700 leading-relaxed">{children}</div>
          {action && <div className="mt-3">{action}</div>}
        </div>
      </div>
    </div>
  );
}

/**
 * Notion-style Side-Peek Drawer for viewing & editing pages without losing database context.
 */
export function NotionSidePeekDrawer({
  open,
  onClose,
  breadcrumb,
  headerActions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  breadcrumb: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-stone-900/25 backdrop-blur-[1px] transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-2xl bg-white h-full border-l border-stone-200 shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-stone-200 bg-white shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 transition-colors"
              aria-label="사이드 패널 닫기"
            >
              <X className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-stone-500 truncate">{breadcrumb}</span>
          </div>
          {headerActions && <div className="flex items-center gap-2 shrink-0">{headerActions}</div>}
        </div>
        <div className="flex-1 overflow-y-auto px-6 sm:px-10 py-8">{children}</div>
      </aside>
    </div>
  );
}

/**
 * Member-only access lock state rendered on restricted pages when visitor is not yet approved.
 */
export function MemberAccessGate({
  sectionTitle,
  description,
  onOpenApplicationModal,
  onNavigate,
}: {
  sectionTitle: string;
  description: string;
  onOpenApplicationModal: () => void;
  onNavigate?: (tab: PageTab) => void;
}) {
  const { authUser, profile, loginWithGoogle } = useAuth();

  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <div className="rounded-xl border border-stone-200 bg-[#F7F6F3] p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-white border border-stone-200 flex items-center justify-center text-[#002968]">
            {profile?.status === 'pending' ? (
              <ShieldAlert className="w-5 h-5 text-amber-700" />
            ) : (
              <Lock className="w-5 h-5" />
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-stone-500">원우회 회원 전용 공간</p>
            <h2 className="text-lg font-bold text-stone-900">{sectionTitle}</h2>
          </div>
        </div>

        <p className="text-sm text-stone-700 leading-relaxed mb-6">{description}</p>

        {!authUser ? (
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={loginWithGoogle}
              className="px-4 py-2.5 text-sm font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Google 계정으로 로그인 및 원우 인증
            </button>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('home')}
                className="px-4 py-2.5 text-sm font-medium text-stone-700 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                원우회 소개로 돌아가기
              </button>
            )}
          </div>
        ) : !profile ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-700">
              현재 <span className="font-semibold text-stone-900">{authUser.email}</span> 계정으로
              로그인되었습니다. 원우회 가입 신청서를 작성해 주시면 관리자 확인 후 즉시 이용하실 수
              있습니다.
            </p>
            <button
              type="button"
              onClick={onOpenApplicationModal}
              className="px-4 py-2.5 text-sm font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              원우회 회원 가입 신청하기
            </button>
          </div>
        ) : profile.status === 'pending' ? (
          <div className="rounded-lg bg-white border border-stone-200 p-4 space-y-2">
            <p className="text-sm font-semibold text-stone-900">가입 승인 대기 중입니다</p>
            <p className="text-sm text-stone-600 leading-relaxed">
              {profile.displayName} ({profile.cohort} · {profile.program}) 원우님의 가입 신청이
              원우회 운영진에게 전달되었습니다. 승인 완료 시 모든 회원 전용 페이지가 열립니다.
            </p>
            <button
              type="button"
              onClick={onOpenApplicationModal}
              className="mt-2 inline-flex items-center px-3 py-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors cursor-pointer"
            >
              신청 정보 수정
            </button>
          </div>
        ) : (
          <div className="rounded-lg bg-white border border-stone-200 p-4 space-y-2">
            <p className="text-sm font-semibold text-red-700">가입 승인이 보류 또는 반려되었습니다</p>
            <p className="text-sm text-stone-600">
              학적 정보(학번 및 기수)를 다시 확인한 뒤 신청 정보를 수정하거나 원우회 관리자에게
              문의해 주세요.
            </p>
            <button
              type="button"
              onClick={onOpenApplicationModal}
              className="mt-2 inline-flex items-center px-3 py-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-md transition-colors cursor-pointer"
            >
              신청 정보 다시 수정하기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
