import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Server,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react';
import {
  API_CONFIG_CHANGED_EVENT,
  BackendAiTestResult,
  BackendHealthResult,
  describeApiTarget,
  getActiveApiBaseUrl,
  getBuildTimeApiBaseUrl,
  getStoredApiBaseUrl,
  isLikelyStaticHosting,
  resetStoredApiBaseUrl,
  setStoredApiBaseUrl,
  testBackendGeminiAi,
  testBackendHealth,
} from '../lib/apiConfig';

export function CloudRunServerBar({
  defaultExpanded = false,
  compact = true,
  title = 'Google Cloud Run · Gemini AI 백엔드 연동',
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
  const [testingAi, setTestingAi] = useState(false);
  const [healthResult, setHealthResult] = useState<BackendHealthResult | null>(null);
  const [aiResult, setAiResult] = useState<BackendAiTestResult | null>(null);

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
    setAiResult(null);
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
    setAiResult(null);
    resetStoredApiBaseUrl();
    const fallback = getBuildTimeApiBaseUrl();
    setStoredUrl('');
    setActiveUrl(fallback);
    setDraftUrl(fallback);
    await runHealthCheck(fallback);
  };

  const handleRunLiveAiTest = async () => {
    setTestingAi(true);
    setAiResult(null);
    try {
      const res = await testBackendGeminiAi();
      setAiResult(res);
    } finally {
      setTestingAi(false);
    }
  };

  const needsSetupWarning =
    staticHosting && !activeUrl && healthResult && healthResult.errorType === 'static_html';

  const statusTone = checkingHealth
    ? 'text-stone-600'
    : healthResult?.ok
      ? 'text-emerald-700'
      : healthResult?.reachable
        ? 'text-amber-700'
        : healthResult
          ? 'text-red-700'
          : 'text-stone-500';

  const statusLabel = checkingHealth
    ? '서버 연결 상태 확인 중...'
    : healthResult?.ok
      ? `연결 정상 · Gemini AI 준비됨 (${healthResult.latencyMs}ms)`
      : healthResult?.reachable
        ? '서버 연결됨 · GEMINI_API_KEY 설정 필요'
        : healthResult?.errorType === 'static_html'
          ? 'Cloud Run 서버 주소 미설정 (정적 호스팅)'
          : healthResult
            ? '서버 연결 또는 CORS 확인 필요'
            : '상태 대기 중';

  return (
    <div
      className={`rounded-xl border transition-colors ${
        needsSetupWarning || (healthResult && !healthResult.reachable)
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
          <button
            type="button"
            onClick={() => void handleRunLiveAiTest()}
            disabled={testingAi || checkingHealth}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#002968] bg-white border border-[#D5DFEE] hover:bg-[#F4F7FB] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className={`w-3.5 h-3.5 ${testingAi ? 'animate-pulse' : ''}`} />
            {testingAi ? 'Gemini AI 호출 중...' : 'AI 분석 실제 테스트'}
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

      {(expanded || !compact || needsSetupWarning || aiResult || inputError || (healthResult && !healthResult.ok)) && (
        <div className="px-4 pb-4 pt-2 border-t border-stone-200/80 space-y-3">
          {healthResult && !healthResult.ok && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
              <p className="font-semibold">백엔드 연결 안내</p>
              <p className="mt-0.5 leading-relaxed">{healthResult.message}</p>
            </div>
          )}

          {aiResult && (
            <div
              className={`rounded-lg border px-3 py-2.5 text-xs flex items-start justify-between gap-2 ${
                aiResult.ok
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                  : 'border-red-200 bg-red-50 text-red-900'
              }`}
            >
              <div className="space-y-1 min-w-0">
                <p className="font-semibold">{aiResult.message}</p>
                {aiResult.ok && aiResult.sampleSummary && (
                  <p className="text-[11px] text-emerald-900 leading-relaxed">
                    <span className="font-semibold">[테스트 응답 · {aiResult.sampleCategory}]</span>{' '}
                    {aiResult.sampleSummary}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAiResult(null)}
                aria-label="테스트 결과 닫기"
                className="text-stone-500 hover:text-stone-800 p-0.5 shrink-0 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {(expanded || !compact || needsSetupWarning) && (
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
                GitHub Pages 정적 웹에서 모든 Gemini AI 논문 요약·분석 및 학술 API 호출을 처리할
                Google Cloud Run 백엔드 URL만 설정합니다.{' '}
                <strong className="font-medium text-stone-700">
                  GEMINI_API_KEY 등 모든 비밀 키는 Cloud Run 환경변수(Secret Manager)에만
                  보관되며 프런트엔드에 저장되거나 노출되지 않습니다.
                </strong>
              </p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
