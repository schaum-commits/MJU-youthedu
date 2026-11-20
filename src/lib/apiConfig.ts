const STORAGE_KEY = 'mju_cloud_run_api_url';
export const API_CONFIG_CHANGED_EVENT = 'mju-api-config-changed';

export interface BackendHealthResult {
  ok: boolean;
  reachable: boolean;
  nanetConfigured: boolean;
  nlConfigured: boolean;
  dbpiaConfigured: boolean;
  openAlexKeyConfigured: boolean;
  environment: string;
  corsMode: string;
  latencyMs: number;
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
  if (
    err instanceof TypeError ||
    (err instanceof Error && /failed to fetch|networkerror|load failed/i.test(err.message))
  ) {
    if (!target && isLikelyStaticHosting()) {
      return `${contextLabel} 서버 주소가 설정되지 않았습니다. 상단 [서버 주소 설정]에서 배포된 Cloud Run URL(https://...run.app)을 입력해 주세요.`;
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
      nanetConfigured: false,
      nlConfigured: false,
      dbpiaConfigured: false,
      openAlexKeyConfigured: false,
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
        nanetConfigured: false,
        nlConfigured: false,
        dbpiaConfigured: false,
        openAlexKeyConfigured: false,
        environment: '',
        corsMode: '',
        latencyMs,
        resolvedBaseUrl: baseLabel,
        errorType: 'static_html',
        message:
          '정적 호스팅(GitHub Pages) 경로입니다. DBpia·도서관 API를 서버에서 호출하려면 Cloud Run URL(https://...run.app)을 설정해 주세요. (OpenAlex·Crossref 논문 수집은 브라우저에서도 정상 작동합니다.)',
      };
    }

    const payload = (await res.json()) as {
      ok?: boolean;
      nanetConfigured?: boolean;
      nlConfigured?: boolean;
      dbpiaConfigured?: boolean;
      openAlexKeyConfigured?: boolean;
      environment?: string;
      corsMode?: string;
      error?: string;
    };

    if (!res.ok || !payload.ok) {
      return {
        ok: false,
        reachable: true,
        nanetConfigured: Boolean(payload.nanetConfigured),
        nlConfigured: Boolean(payload.nlConfigured),
        dbpiaConfigured: Boolean(payload.dbpiaConfigured),
        openAlexKeyConfigured: Boolean(payload.openAlexKeyConfigured),
        environment: payload.environment || '',
        corsMode: payload.corsMode || '',
        latencyMs,
        resolvedBaseUrl: baseLabel,
        errorType: 'http_error',
        message: payload.error || `서버 상태 점검 오류 (HTTP ${res.status})`,
      };
    }

    return {
      ok: true,
      reachable: true,
      nanetConfigured: Boolean(payload.nanetConfigured),
      nlConfigured: Boolean(payload.nlConfigured),
      dbpiaConfigured: Boolean(payload.dbpiaConfigured),
      openAlexKeyConfigured: Boolean(payload.openAlexKeyConfigured),
      environment: payload.environment || 'node_server',
      corsMode: payload.corsMode || 'github_pages_default',
      latencyMs,
      resolvedBaseUrl: baseLabel,
      message: `Cloud Run · Express 학술 API 서버 연결이 정상입니다 (${latencyMs}ms).`,
    };
  } catch (err) {
    return {
      ok: false,
      reachable: false,
      nanetConfigured: false,
      nlConfigured: false,
      dbpiaConfigured: false,
      openAlexKeyConfigured: false,
      environment: '',
      corsMode: '',
      latencyMs: Math.round(performance.now() - started),
      resolvedBaseUrl: baseLabel,
      errorType: 'network_cors',
      message: formatServerFetchError(err, 'Cloud Run 서버'),
    };
  }
}
