const STORAGE_KEY = 'mju_cloud_run_api_url';
export const API_CONFIG_CHANGED_EVENT = 'mju-api-config-changed';

export interface BackendHealthResult {
  ok: boolean;
  reachable: boolean;
  geminiConfigured: boolean;
  nanetConfigured: boolean;
  nlConfigured: boolean;
  dbpiaConfigured: boolean;
  openAlexKeyConfigured: boolean;
  model: string;
  environment: string;
  corsMode: string;
  latencyMs: number;
  resolvedBaseUrl: string;
  errorType?: 'static_html' | 'network_cors' | 'http_error';
  message: string;
}

export interface BackendAiTestResult {
  ok: boolean;
  model: string;
  latencyMs: number;
  sampleSummary?: string;
  sampleCategory?: string;
  resolvedBaseUrl: string;
  errorType?: 'static_html' | 'network_cors' | 'http_error';
  message: string;
}

export function getBuildTimeApiBaseUrl(): string {
  const raw =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_API_BASE_URL || '';
  return normalizeOptionalBaseUrl(raw);
}

export function normalizeOptionalBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('올바른 서버 주소(URL) 형식이 아닙니다. 예: https://service-name.run.app');
  }
  const isHttps = parsed.protocol === 'https:';
  const isLocalHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

  if (!isHttps && !isLocalHttp) {
    throw new Error('보안을 위해 HTTPS 주소(또는 로컬 http://localhost)만 입력할 수 있습니다.');
  }

  let pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname.toLowerCase().endsWith('/api')) {
    pathname = pathname.slice(0, -4);
  }
  return `${parsed.origin}${pathname}`;
}

export function getStoredApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) || '';
    return saved ? normalizeOptionalBaseUrl(saved) : '';
  } catch {
    return '';
  }
}

export function getActiveApiBaseUrl(): string {
  return getStoredApiBaseUrl() || getBuildTimeApiBaseUrl();
}

export function setStoredApiBaseUrl(rawUrl: string): string {
  const normalized = normalizeOptionalBaseUrl(rawUrl);
  if (typeof window !== 'undefined') {
    try {
      if (normalized) {
        window.localStorage.setItem(STORAGE_KEY, normalized);
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
      window.dispatchEvent(new CustomEvent(API_CONFIG_CHANGED_EVENT, { detail: normalized }));
    } catch {
      // Ignore storage quota / privacy mode errors safely
    }
  }
  return normalized;
}

export function resetStoredApiBaseUrl(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.dispatchEvent(
        new CustomEvent(API_CONFIG_CHANGED_EVENT, { detail: getBuildTimeApiBaseUrl() })
      );
    } catch {
      // Ignore safely
    }
  }
}

export function resolveApiUrl(apiPath: string, overrideBaseUrl?: string): string {
  const cleanPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  const base =
    overrideBaseUrl !== undefined
      ? normalizeOptionalBaseUrl(overrideBaseUrl)
      : getActiveApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

export function isLikelyStaticHosting(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname.toLowerCase();
  return host.endsWith('.github.io') || window.location.protocol === 'file:';
}

export function describeApiTarget(overrideBaseUrl?: string): string {
  const base =
    overrideBaseUrl !== undefined
      ? normalizeOptionalBaseUrl(overrideBaseUrl)
      : getActiveApiBaseUrl();
  if (base) return base;
  if (typeof window !== 'undefined') {
    return `${window.location.origin} (동일 오리진)`;
  }
  return '동일 오리진 (/api)';
}

export function formatServerFetchError(err: unknown, contextLabel = 'Cloud Run API'): string {
  const target = getActiveApiBaseUrl();
  if (err instanceof TypeError || (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message))) {
    if (!target && isLikelyStaticHosting()) {
      return `${contextLabel} 서버 주소가 설정되지 않았습니다. 상단 [Cloud Run 서버 연결 설정]에서 배포된 Cloud Run URL(https://...run.app)을 입력해 주세요.`;
    }
    return `${contextLabel} 서버(${target || '현재 호스트'})에 연결할 수 없습니다. 서버 실행 상태, 주소 오타 또는 CORS(ALLOWED_ORIGINS) 허용 여부를 확인해 주세요.`;
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return `${contextLabel} 요청 처리 중 네트워크 오류가 발생했습니다.`;
}

export async function testBackendHealth(overrideBaseUrl?: string): Promise<BackendHealthResult> {
  const started = performance.now();
  let resolvedUrl = '/api/health';
  let baseLabel = describeApiTarget(overrideBaseUrl);

  try {
    resolvedUrl = resolveApiUrl('/api/health', overrideBaseUrl);
    baseLabel = describeApiTarget(overrideBaseUrl);
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      geminiConfigured: false,
      nanetConfigured: false,
      nlConfigured: false,
      dbpiaConfigured: false,
      openAlexKeyConfigured: false,
      model: '',
      environment: '',
      corsMode: '',
      latencyMs: 0,
      resolvedBaseUrl: baseLabel,
      errorType: 'http_error',
      message: err instanceof Error ? err.message : '잘못된 서버 주소입니다.',
    };
  }

  try {
    const res = await fetch(resolvedUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const latencyMs = Math.round(performance.now() - started);
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        reachable: false,
        geminiConfigured: false,
        nanetConfigured: false,
        nlConfigured: false,
        dbpiaConfigured: false,
        openAlexKeyConfigured: false,
        model: '',
        environment: '',
        corsMode: '',
        latencyMs,
        resolvedBaseUrl: baseLabel,
        errorType: 'static_html',
        message:
          '정적 웹페이지 응답(HTML)이 반환되었습니다. GitHub Pages에서 AI 분석을 사용하려면 Cloud Run 서버 주소(https://...run.app)를 설정해 주세요.',
      };
    }

    const payload = (await res.json()) as {
      ok?: boolean;
      geminiConfigured?: boolean;
      nanetConfigured?: boolean;
      nlConfigured?: boolean;
      dbpiaConfigured?: boolean;
      openAlexKeyConfigured?: boolean;
      model?: string;
      environment?: string;
      corsMode?: string;
      error?: string;
    };

    if (!res.ok || !payload.ok) {
      return {
        ok: false,
        reachable: true,
        geminiConfigured: Boolean(payload.geminiConfigured),
        nanetConfigured: Boolean(payload.nanetConfigured),
        nlConfigured: Boolean(payload.nlConfigured),
        dbpiaConfigured: Boolean(payload.dbpiaConfigured),
        openAlexKeyConfigured: Boolean(payload.openAlexKeyConfigured),
        model: payload.model || '',
        environment: payload.environment || '',
        corsMode: payload.corsMode || '',
        latencyMs,
        resolvedBaseUrl: baseLabel,
        errorType: 'http_error',
        message: payload.error || `서버 상태 점검 오류 (HTTP ${res.status})`,
      };
    }

    const geminiOk = Boolean(payload.geminiConfigured);
    return {
      ok: geminiOk,
      reachable: true,
      geminiConfigured: geminiOk,
      nanetConfigured: Boolean(payload.nanetConfigured),
      nlConfigured: Boolean(payload.nlConfigured),
      dbpiaConfigured: Boolean(payload.dbpiaConfigured),
      openAlexKeyConfigured: Boolean(payload.openAlexKeyConfigured),
      model: payload.model || 'gemini-4-hydrogen',
      environment: payload.environment || 'node_server',
      corsMode: payload.corsMode || 'github_pages_default',
      latencyMs,
      resolvedBaseUrl: baseLabel,
      message: geminiOk
        ? `Cloud Run API 서버 연결 및 Gemini AI 키 구성이 확인되었습니다 (${latencyMs}ms).`
        : `API 서버는 응답했으나 GEMINI_API_KEY가 아직 설정되지 않았습니다. Cloud Run 환경변수 또는 Secret Manager를 확인해 주세요.`,
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      geminiConfigured: false,
      nanetConfigured: false,
      nlConfigured: false,
      dbpiaConfigured: false,
      openAlexKeyConfigured: false,
      model: '',
      environment: '',
      corsMode: '',
      latencyMs: Math.round(performance.now() - started),
      resolvedBaseUrl: baseLabel,
      errorType: 'network_cors',
      message: formatServerFetchError(err, 'Cloud Run 서버'),
    };
  }
}

export async function testBackendGeminiAi(overrideBaseUrl?: string): Promise<BackendAiTestResult> {
  const started = performance.now();
  let resolvedUrl = '/api/health/ai-test';
  let baseLabel = describeApiTarget(overrideBaseUrl);

  try {
    resolvedUrl = resolveApiUrl('/api/health/ai-test', overrideBaseUrl);
    baseLabel = describeApiTarget(overrideBaseUrl);
  } catch (err) {
    return {
      ok: false,
      model: '',
      latencyMs: 0,
      resolvedBaseUrl: baseLabel,
      errorType: 'http_error',
      message: err instanceof Error ? err.message : '잘못된 서버 주소입니다.',
    };
  }

  try {
    const res = await fetch(resolvedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const latencyMs = Math.round(performance.now() - started);
    const contentType = res.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        model: '',
        latencyMs,
        resolvedBaseUrl: baseLabel,
        errorType: 'static_html',
        message:
          '정적 호스팅 경로에서는 Gemini AI 엔드포인트를 호출할 수 없습니다. Cloud Run 서버 주소를 먼저 설정해 주세요.',
      };
    }

    const payload = (await res.json()) as {
      ok?: boolean;
      model?: string;
      latencyMs?: number;
      sampleSummary?: string;
      sampleCategory?: string;
      error?: string;
    };

    if (!res.ok || !payload.ok) {
      return {
        ok: false,
        model: payload.model || '',
        latencyMs,
        resolvedBaseUrl: baseLabel,
        errorType: 'http_error',
        message: payload.error || `Gemini AI 테스트 오류 (HTTP ${res.status})`,
      };
    }

    return {
      ok: true,
      model: payload.model || 'gemini-4-hydrogen',
      latencyMs: payload.latencyMs ?? latencyMs,
      sampleSummary: payload.sampleSummary,
      sampleCategory: payload.sampleCategory,
      resolvedBaseUrl: baseLabel,
      message: `Cloud Run 서버에서 Gemini AI(${payload.model || 'gemini-4-hydrogen'}) 실제 분석 응답을 확인했습니다 (${payload.latencyMs ?? latencyMs}ms).`,
    };
  } catch (err) {
    return {
      ok: false,
      model: '',
      latencyMs: Math.round(performance.now() - started),
      resolvedBaseUrl: baseLabel,
      errorType: 'network_cors',
      message: formatServerFetchError(err, 'Gemini AI 분석'),
    };
  }
}
