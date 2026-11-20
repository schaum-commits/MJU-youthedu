import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Server,
  Settings2,
} from 'lucide-react';
import {
  API_CONFIG_CHANGED_EVENT,
  BackendHealthResult,
  describeApiTarget,
  getActiveApiBaseUrl,
  getBuildTimeApiBaseUrl,
  getStoredApiBaseUrl,
  isLikelyStaticHosting,
  resetStoredApiBaseUrl,
  setStoredApiBaseUrl,
  testBackendHealth,
} from '../lib/apiConfig';

export function CloudRunServerBar({
  defaultExpanded = false,
  compact = true,
  title = 'Google Cloud Run 학술 API 서버 연동',
}: {
  defaultExpanded?: boolean;
  compact?: boolean;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeUrl, setActiveUrl] = useState(() => getActiveApiBaseUrl());
  const [storedUrl, setStoredUrl] = useState(() => getStoredApiBaseUrl());
  const [buildUrl] = useState(() => getBuildTimeApiBaseUrl());
  const [draftUrl, setDraftUrl] = useState(() => getActiveApiBaseUrl());
  const [inputError, setInputError] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [healthResult, setHealthResult] = useState<BackendHealthResult | null>(null);

  const staticHosting = isLikelyStaticHosting();

  const runHealthCheck = async (targetOverride?: string) => {
    setCheckingHealth(true);
    try {
      const res = await testBackendHealth(targetOverride);
      setHealthResult(res);
      return res;
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    const syncState = () => {
      const nextActive = getActiveApiBaseUrl();
      setActiveUrl(nextActive);
      setStoredUrl(getStoredApiBaseUrl());
      setDraftUrl(nextActive);
    };
    window.addEventListener(API_CONFIG_CHANGED_EVENT, syncState);
    void runHealthCheck();
    return () => {
      window.removeEventListener(API_CONFIG_CHANGED_EVENT, syncState);
    };
  }, []);

  const handleSaveServerUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    setInputError(null);
    try {
      const saved = setStoredApiBaseUrl(draftUrl);
      const effective = saved || getBuildTimeApiBaseUrl();
      setActiveUrl(effective);
      setStoredUrl(saved);
      setDraftUrl(effective);
      await runHealthCheck(effective);
    } catch (err) {
      setInputError(err instanceof Error ? err.message : '서버 주소를 저장할 수 없습니다.');
    }
  };

  const handleResetServerUrl = async () => {
    setInputError(null);
    resetStoredApiBaseUrl();
    const fallback = getBuildTimeApiBaseUrl();
    setStoredUrl('');
    setActiveUrl(fallback);
    setDraftUrl(fallback);
    await runHealthCheck(fallback);
  };

  const needsSetupWarning =
    staticHosting && !activeUrl && healthResult && healthResult.errorType === 'static_html';

  const statusTone = checkingHealth
    ? 'text-stone-600'
    : healthResult?.ok
      ? 'text-emerald-700'
      : healthResult
        ? 'text-amber-800'
        : 'text-stone-500';

  const statusLabel = checkingHealth
    ? '서버 연결 상태 확인 중...'
    : healthResult?.ok
      ? `연결 정상 (${healthResult.latencyMs}ms)`
      : healthResult?.errorType === 'static_html'
        ? 'Cloud Run 미설정 (브라우저 직접 수집 사용)'
        : healthResult
          ? '서버 연결 또는 CORS 확인 필요'
          : '상태 대기 중';

  return (
    <div
      className={`rounded-xl border transition-colors ${
        needsSetupWarning || (healthResult && !healthResult.reachable && Boolean(activeUrl))
          ? 'border-amber-300 bg-amber-50/70'
          : 'border-stone-200 bg-[#F7F6F3]'
      }`}
    >
      <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white border border-stone-200 flex items-center justify-center shrink-0 text-[#002968]">
            <Server className="w-4 h-4" />
          </div>
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              <span className="font-bold text-stone-900">{title}</span>
              <span className="text-stone-300" aria-hidden="true">
                ·
              </span>
              <span className={`font-semibold inline-flex items-center gap-1 ${statusTone}`}>
                {checkingHealth ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : healthResult?.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                ) : healthResult ? (
                  <AlertTriangle className="w-3.5 h-3.5" />
                ) : null}
                {statusLabel}
              </span>
            </div>
            <p className="text-[11px] text-stone-600 truncate">
              현재 API 서버:{' '}
              <span className="font-mono text-stone-800">{describeApiTarget()}</span>
              {storedUrl ? ' (브라우저 저장 설정)' : buildUrl ? ' (빌드 환경변수)' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void runHealthCheck()}
            disabled={checkingHealth}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? 'animate-spin' : ''}`} />
            연결 확인
          </button>
          {compact && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-800 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Settings2 className="w-3.5 h-3.5" />
              {expanded ? '설정 닫기' : '서버 주소 설정'}
            </button>
          )}
        </div>
      </div>

      {(expanded || !compact || (healthResult && !healthResult.ok && Boolean(activeUrl))) && (
        <div className="px-4 pb-4 pt-2 border-t border-stone-200/80 space-y-3">
          {healthResult && !healthResult.ok && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <p className="font-semibold">백엔드 연결 안내</p>
              <p className="mt-0.5 leading-relaxed">{healthResult.message}</p>
            </div>
          )}

          {(expanded || !compact) && (
            <form onSubmit={handleSaveServerUrl} className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label htmlFor="cloud-run-url-input" className="sr-only">
                  Google Cloud Run API 서버 주소
                </label>
                <input
                  id="cloud-run-url-input"
                  type="url"
                  value={draftUrl}
                  onChange={(e) => {
                    setDraftUrl(e.target.value);
                    if (inputError) setInputError(null);
                  }}
                  placeholder="https://mju-youth-api-xxxxx-du.a.run.app (비워 두면 기본값 사용)"
                  className="flex-1 px-3 py-1.5 text-xs font-mono border border-stone-300 rounded-lg bg-white text-stone-900 focus:outline-none focus:border-[#002968]"
                />
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="submit"
                    disabled={checkingHealth}
                    className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#002968] hover:bg-[#001f4f] disabled:opacity-60 rounded-lg whitespace-nowrap cursor-pointer"
                  >
                    서버 주소 저장 및 확인
                  </button>
                  {(storedUrl || draftUrl) && (
                    <button
                      type="button"
                      onClick={() => void handleResetServerUrl()}
                      disabled={checkingHealth}
                      className="px-3 py-1.5 text-xs font-medium text-stone-700 bg-white border border-stone-300 hover:bg-stone-50 rounded-lg whitespace-nowrap cursor-pointer"
                    >
                      기본값 복원
                    </button>
                  )}
                </div>
              </div>
              {inputError && <p className="text-xs font-medium text-red-700">{inputError}</p>}
              <p className="text-[11px] text-stone-500 leading-relaxed">
                DBpia 실시간 검색 및 도서관 Open API 프록시를 호출할 Cloud Run 백엔드 URL을
                설정합니다. OpenAlex·Crossref 6대 분야 논문 수집은 서버 연결 없이도 브라우저에서
                직접 실행할 수 있습니다.
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
