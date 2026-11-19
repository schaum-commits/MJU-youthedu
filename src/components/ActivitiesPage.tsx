import React, { useMemo, useState } from 'react';
import { CalendarDays, LayoutGrid, List, MapPin, Plus, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ActivityCategory, CouncilActivity } from '../types/community';
import { NotionSidePeekDrawer, ResilientImage } from './NotionPrimitives';

const CATEGORIES: ActivityCategory[] = ['공지사항'];

export function ActivitiesPage({
  activities,
  selectedActivity,
  onSelectActivity,
  onNavigateToAdminActivities,
}: {
  activities: CouncilActivity[];
  selectedActivity: CouncilActivity | null;
  onSelectActivity: (activity: CouncilActivity | null) => void;
  onNavigateToAdminActivities: () => void;
}) {
  const { isAdmin } = useAuth();
  const [category, setCategory] = useState<ActivityCategory>('공지사항');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'gallery' | 'list'>('gallery');

  const filtered = useMemo(() => {
    return activities.filter((item) => {
      if (!isAdmin && !item.isPublished) return false;
      if (item.category !== category) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          item.title.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          item.location.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [activities, category, search, isAdmin]);

  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-10 py-8 sm:py-10">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-stone-200 mb-6">
        <div>
          <p className="text-xs font-medium text-stone-500 mb-1">원우회 아카이브</p>
          <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
            원우회 활동 소개 및 일정
          </h1>
          <p className="text-sm text-stone-600 mt-1.5">
            학술 콜로퀴엄, 신입생 환영회, 청소년 기관 현장 탐방 등 원우회의 주요 활동을 기록합니다.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={onNavigateToAdminActivities}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#002968] hover:bg-[#001f4f] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            활동 등록 · 관리
          </button>
        )}
      </div>

      {/* Notion Database Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-lg overflow-x-auto">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                category === cat
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="활동 제목 또는 장소 검색"
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-stone-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-[#002968]/20 focus:border-[#002968]"
            />
          </div>
          <div className="flex items-center gap-0.5 p-0.5 bg-stone-100 rounded-md shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('gallery')}
              className={`p-1.5 rounded cursor-pointer ${
                viewMode === 'gallery' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
              aria-label="갤러리 보기"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded cursor-pointer ${
                viewMode === 'list' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500'
              }`}
              aria-label="리스트 보기"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-10 text-center">
          <p className="text-sm text-stone-600">조건에 맞는 원우회 활동 기록이 없습니다.</p>
        </div>
      ) : viewMode === 'gallery' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {filtered.map((item) => (
            <article
              key={item.id}
              onClick={() => onSelectActivity(item)}
              className="group rounded-lg border border-stone-200 bg-white overflow-hidden hover:border-stone-300 transition-colors cursor-pointer flex flex-col"
            >
              <div className="aspect-[4/3] w-full bg-stone-100 overflow-hidden border-b border-stone-100">
                <ResilientImage
                  src={item.imageUrl}
                  alt={item.title}
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
                  fallbackTitle={item.title}
                />
              </div>
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-center gap-1.5 text-xs text-stone-500 mb-1.5 tabular-nums">
                  <span>{item.category}</span>
                  <span aria-hidden="true">·</span>
                  <span>{item.eventDate}</span>
                  {!item.isPublished && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-700 font-medium">비공개</span>
                    </>
                  )}
                </div>
                <h2 className="text-base font-bold text-stone-900 leading-snug mb-2 group-hover:text-[#002968]">
                  {item.title}
                </h2>
                <p className="text-xs text-stone-600 leading-relaxed line-clamp-2 mb-3">
                  {item.summary}
                </p>
                <div className="mt-auto pt-2.5 border-t border-stone-100 flex items-center gap-1.5 text-xs text-stone-500">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{item.location}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white divide-y divide-stone-100 overflow-hidden">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectActivity(item)}
              className="w-full text-left px-4 py-3.5 hover:bg-[#F7F6F3] transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2 cursor-pointer"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-stone-500 mb-0.5">
                  <span>{item.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{item.location}</span>
                  {!item.isPublished && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-700 font-medium">비공개</span>
                    </>
                  )}
                </div>
                <p className="text-sm font-semibold text-stone-900 truncate">{item.title}</p>
              </div>
              <span className="text-xs text-stone-500 font-mono tabular-nums shrink-0">
                {item.eventDate}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Notion Side-Peek Detail Drawer */}
      <NotionSidePeekDrawer
        open={Boolean(selectedActivity)}
        onClose={() => onSelectActivity(null)}
        breadcrumb={`원우회 활동 / ${selectedActivity?.category || ''}`}
      >
        {selectedActivity && (
          <div>
            {selectedActivity.imageUrl && (
              <div className="aspect-[16/9] w-full rounded-lg overflow-hidden border border-stone-200 mb-6 bg-stone-100">
                <ResilientImage
                  src={selectedActivity.imageUrl}
                  alt={selectedActivity.title}
                  className="w-full h-full object-cover"
                  fallbackTitle={selectedActivity.title}
                />
              </div>
            )}
            <div className="flex items-center gap-2 text-xs text-stone-500 mb-2">
              <span>{selectedActivity.category}</span>
              <span aria-hidden="true">·</span>
              <span>작성: {selectedActivity.authorName}</span>
            </div>
            <h2 className="font-serif text-2xl font-bold text-stone-900 leading-snug mb-5">
              {selectedActivity.title}
            </h2>

            <dl className="rounded-lg border border-stone-200 bg-[#F7F6F3] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mb-6">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-[#002968] shrink-0" />
                <div>
                  <dt className="text-stone-500">일시</dt>
                  <dd className="font-semibold text-stone-900 tabular-nums">
                    {selectedActivity.eventDate}
                  </dd>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-[#002968] shrink-0" />
                <div>
                  <dt className="text-stone-500">장소</dt>
                  <dd className="font-semibold text-stone-900">{selectedActivity.location}</dd>
                </div>
              </div>
            </dl>

            <div className="prose prose-stone max-w-none">
              <p className="text-sm font-medium text-stone-800 mb-4 leading-relaxed">
                {selectedActivity.summary}
              </p>
              <div className="text-sm text-stone-700 leading-relaxed whitespace-pre-line border-t border-stone-200 pt-5">
                {selectedActivity.content}
              </div>
            </div>
          </div>
        )}
      </NotionSidePeekDrawer>
    </div>
  );
}
