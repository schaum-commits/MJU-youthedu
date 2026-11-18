import { User } from 'firebase/auth';
import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import {
  LIMITS,
  ResearchSyncMode,
  ResearchSyncStatus,
  ResearchTrend,
  TrendCategory,
} from '../types/community';

export const RESEARCH_SYNC_INTERVAL_DAYS = 14;
export const RESEARCH_SYNC_INTERVAL_MS = RESEARCH_SYNC_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

export interface GroundedResearchPaper {
  title: string;
  category: TrendCategory;
  source: string;
  publishedPeriod: string;
  externalUrl: string;
  summary: string;
  keyTakeaway: string;
}

export interface ResearchSyncResult {
  ok: boolean;
  insertedCount: number;
  checkedCount: number;
  windowLabel: string;
  message: string;
  staticHostingUnavailable?: boolean;
}

let syncInFlightPromise: Promise<ResearchSyncResult> | null = null;

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim();
}

function buildSafeScholarDocId(title: string, publishedPeriod: string): string {
  const input = `${normalizeTitle(title)}|${publishedPeriod.trim()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const part1 = (h1 >>> 0).toString(36);
  const part2 = (h2 >>> 0).toString(36);
  const periodSlug = publishedPeriod.replace(/[^0-9]/g, '').slice(0, 6) || 'latest';
  return `scholar-${periodSlug}-${part1}${part2}`.slice(0, 120);
}

export function getGoogleScholarSearchUrl(title: string): string {
  return `https://scholar.google.co.kr/scholar?q=${encodeURIComponent(title)}`;
}

export async function checkResearchServerAvailable(): Promise<boolean> {
  try {
    const res = await fetch('/api/health', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return false;
    }
    const data = (await res.json()) as { ok?: boolean };
    return Boolean(data.ok);
  } catch {
    return false;
  }
}

export async function toggleResearchAutoSync({
  enabled,
  authUser,
  actorName,
  currentStatus,
}: {
  enabled: boolean;
  authUser: User;
  actorName: string;
  currentStatus: ResearchSyncStatus | null;
}): Promise<void> {
  const path = 'settings/researchSync';
  const lastMs = currentStatus?.lastSyncedAt?.toMillis?.() ?? Date.now();
  const nextSyncAt = Timestamp.fromMillis(lastMs + RESEARCH_SYNC_INTERVAL_MS);

  try {
    await setDoc(doc(db, 'settings', 'researchSync'), {
      autoEnabled: enabled,
      intervalDays: RESEARCH_SYNC_INTERVAL_DAYS,
      ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
      ...(enabled ? { nextSyncAt } : {}),
      lastSyncStatus: currentStatus?.lastSyncStatus || 'idle',
      ...(currentStatus?.lastSyncMode ? { lastSyncMode: currentStatus.lastSyncMode } : {}),
      lastSyncCount: currentStatus?.lastSyncCount ?? 0,
      lastSyncMessage: (
        enabled
          ? '2주 주기 구글 학술검색 AI 자동 업데이트가 활성화되었습니다.'
          : '2주 주기 구글 학술검색 AI 자동 업데이트가 일시 중지되었습니다.'
      ).slice(0, 400),
      ...(currentStatus?.windowLabel ? { windowLabel: currentStatus.windowLabel } : {}),
      updatedByUid: authUser.uid,
      updatedByName: actorName.slice(0, LIMITS.displayName),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function runResearchSync({
  mode,
  authUser,
  actorName,
  existingTrends,
  autoEnabled = true,
  currentStatus = null,
}: {
  mode: 'initial_1y' | 'biweekly';
  authUser: User;
  actorName: string;
  existingTrends: ResearchTrend[];
  autoEnabled?: boolean;
  currentStatus?: ResearchSyncStatus | null;
}): Promise<ResearchSyncResult> {
  if (syncInFlightPromise) {
    return syncInFlightPromise;
  }

  syncInFlightPromise = (async (): Promise<ResearchSyncResult> => {
    const statusRef = doc(db, 'settings', 'researchSync');
    const safeActorName = (actorName || '원우회 관리자').slice(0, LIMITS.displayName);

    const existingUrls = existingTrends
      .map((t) => t.externalUrl?.trim())
      .filter((u): u is string => Boolean(u));
    const existingTitles = existingTrends.map((t) => t.title);
    const existingUrlSet = new Set(existingUrls);
    const existingTitleSet = new Set(existingTitles.map(normalizeTitle));
    const existingIdSet = new Set(existingTrends.map((t) => t.id));

    try {
      await setDoc(statusRef, {
        autoEnabled,
        intervalDays: RESEARCH_SYNC_INTERVAL_DAYS,
        ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
        ...(currentStatus?.nextSyncAt ? { nextSyncAt: currentStatus.nextSyncAt } : {}),
        lastSyncStatus: 'syncing',
        lastSyncMode: mode as ResearchSyncMode,
        lastSyncCount: currentStatus?.lastSyncCount ?? 0,
        lastSyncMessage:
          mode === 'initial_1y'
            ? '구글 학술검색 최근 1년 청소년지도학 논문 수집 및 AI 요약 진행 중...'
            : '구글 학술검색 2주 주기 최신 논문 업데이트 진행 중...',
        ...(currentStatus?.windowLabel ? { windowLabel: currentStatus.windowLabel } : {}),
        updatedByUid: authUser.uid,
        updatedByName: safeActorName,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/researchSync');
    }

    try {
      const response = await fetch('/api/research/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          existingUrls,
          existingTitles,
        }),
      });

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const staticMessage =
          '현재 정적 호스팅 환경에서는 구글 학술검색 AI 수집 API 서버를 실행할 수 없습니다. AI Studio 서버 환경에서 실행하거나 자동 동기화된 DB 내역을 확인해 주세요.';
        await setDoc(statusRef, {
          autoEnabled,
          intervalDays: RESEARCH_SYNC_INTERVAL_DAYS,
          ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
          ...(currentStatus?.nextSyncAt ? { nextSyncAt: currentStatus.nextSyncAt } : {}),
          lastSyncStatus: currentStatus?.lastSyncedAt ? currentStatus.lastSyncStatus : 'error',
          lastSyncMode: mode,
          lastSyncCount: currentStatus?.lastSyncCount ?? 0,
          lastSyncMessage: staticMessage.slice(0, 400),
          ...(currentStatus?.windowLabel ? { windowLabel: currentStatus.windowLabel } : {}),
          updatedByUid: authUser.uid,
          updatedByName: safeActorName,
          updatedAt: serverTimestamp(),
        });
        return {
          ok: false,
          insertedCount: 0,
          checkedCount: 0,
          windowLabel: currentStatus?.windowLabel || '',
          message: staticMessage,
          staticHostingUnavailable: true,
        };
      }

      const payload = (await response.json()) as {
        papers?: GroundedResearchPaper[];
        windowLabel?: string;
        sourcesChecked?: number;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || `서버 응답 오류 (${response.status})`);
      }

      const papers = Array.isArray(payload.papers) ? payload.papers : [];
      const windowLabel = (payload.windowLabel || '').slice(0, 80);
      const checkedCount = payload.sourcesChecked ?? papers.length;

      const batch = writeBatch(db);
      let insertedCount = 0;

      papers.forEach((paper) => {
        const docId = buildSafeScholarDocId(paper.title, paper.publishedPeriod);
        const normTitle = normalizeTitle(paper.title);
        if (
          existingIdSet.has(docId) ||
          existingUrlSet.has(paper.externalUrl) ||
          existingTitleSet.has(normTitle)
        ) {
          return;
        }
        existingIdSet.add(docId);
        existingUrlSet.add(paper.externalUrl);
        existingTitleSet.add(normTitle);

        batch.set(doc(db, 'researchTrends', docId), {
          title: paper.title.trim().slice(0, LIMITS.trendTitle),
          category: paper.category,
          source: paper.source.trim().slice(0, LIMITS.source),
          publishedPeriod: paper.publishedPeriod.trim().slice(0, LIMITS.publishedPeriod),
          externalUrl: paper.externalUrl.trim().slice(0, LIMITS.trendUrl),
          summary: paper.summary.trim().slice(0, LIMITS.trendSummary),
          ...(paper.keyTakeaway?.trim()
            ? { keyTakeaway: paper.keyTakeaway.trim().slice(0, LIMITS.keyTakeaway) }
            : {}),
          isPinned: false,
          authorUid: authUser.uid,
          authorName: '구글 학술검색 AI',
          authorCohort: (
            mode === 'initial_1y' ? '구글 학술검색 최근 1년' : '구글 학술검색 2주 자동'
          ).slice(0, LIMITS.cohort),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        insertedCount += 1;
      });

      const nextSyncAt = Timestamp.fromMillis(Date.now() + RESEARCH_SYNC_INTERVAL_MS);
      const successMessage =
        insertedCount > 0
          ? `구글 학술검색 연동 결과 신규 논문 ${insertedCount}편이 연구 동향 아카이브에 반영되었습니다.`
          : payload.message ||
            `구글 학술검색 출처 ${checkedCount}건을 점검했으며, 모두 이미 등록되어 최신 상태입니다.`;

      batch.set(statusRef, {
        autoEnabled,
        intervalDays: RESEARCH_SYNC_INTERVAL_DAYS,
        lastSyncedAt: serverTimestamp(),
        nextSyncAt,
        lastSyncStatus: 'success',
        lastSyncMode: mode,
        lastSyncCount: insertedCount,
        lastSyncMessage: successMessage.slice(0, 400),
        windowLabel,
        updatedByUid: authUser.uid,
        updatedByName: safeActorName,
        updatedAt: serverTimestamp(),
      });

      await batch.commit();

      return {
        ok: true,
        insertedCount,
        checkedCount,
        windowLabel,
        message: successMessage,
      };
    } catch (error) {
      const errMessage =
        error instanceof Error ? error.message : '구글 학술검색 연구 동향 동기화에 실패했습니다.';
      try {
        await setDoc(statusRef, {
          autoEnabled,
          intervalDays: RESEARCH_SYNC_INTERVAL_DAYS,
          ...(currentStatus?.lastSyncedAt ? { lastSyncedAt: currentStatus.lastSyncedAt } : {}),
          ...(currentStatus?.nextSyncAt ? { nextSyncAt: currentStatus.nextSyncAt } : {}),
          lastSyncStatus: 'error',
          lastSyncMode: mode,
          lastSyncCount: 0,
          lastSyncMessage: errMessage.slice(0, 400),
          ...(currentStatus?.windowLabel ? { windowLabel: currentStatus.windowLabel } : {}),
          updatedByUid: authUser.uid,
          updatedByName: safeActorName,
          updatedAt: serverTimestamp(),
        });
      } catch (writeErr) {
        handleFirestoreError(writeErr, OperationType.WRITE, 'settings/researchSync');
      }

      return {
        ok: false,
        insertedCount: 0,
        checkedCount: 0,
        windowLabel: currentStatus?.windowLabel || '',
        message: errMessage,
      };
    } finally {
      syncInFlightPromise = null;
    }
  })();

  return syncInFlightPromise;
}
