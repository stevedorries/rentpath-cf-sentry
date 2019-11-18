// Get the key from the "DSN" at: https://sentry.io/settings/<org>/projects/<project>/keys/
// The "DSN" will be in the form: https://<SENTRY_KEY>@sentry.io/<SENTRY_PROJECT_ID>
// eg, https://0000aaaa1111bbbb2222cccc3333dddd@sentry.io/123456
//
// https://docs.sentry.io/error-reporting/configuration/?platform=javascript#release
// release: A string describing the version – we just use: git rev-parse --verify HEAD
// You can use this to associate files/source-maps: https://docs.sentry.io/cli/releases/#upload-files

const CLIENT_NAME = 'rentpath-cf-sentry'
const CLIENT_VERSION = '1.0.0'
const RETRIES = 5

export async function log(err: Error, request: Request, app: string, release: string, projectId: string, dsn: string, env?: string) {
  const body = JSON.stringify(toSentryEvent(err, request, app, release, env))

  for (let i = 0; i <= 5; i++) {
    const res = await fetch(`https://sentry.io/api/${projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': 'Sentry sentry_version=7,sentry_client=rentpath-cf-sentry/1.0.0,sentry_key=${dsn}',
      },
      body,
    })
    if (res.status === 200) {
      return
    }
    console.error({ httpStatus: res.status, ...(await res.json()) })
  }
}

function toSentryEvent(err: Error, request: Request, app: string, release: string, env?: string) {
  const errType = err.name
  const frames = parse(err)
  const extraKeys = Object.keys(err).filter(key => !['name', 'message', 'stack'].includes(key))
  return {
    event_id: uuidv4(),
    message: errType + ': ' + (err.message || '<no message>'),
    exception: {
      values: [
        {
          type: errType,
          value: err.message,
          stacktrace: frames.length ? { frames: frames.reverse() } : undefined,
        },
      ],
    },
    extra: extraKeys.length
      ? {
        [errType]: extraKeys.reduce((obj, key) => ({ ...obj, [key]: (err as any)[key] }), {}),
        }
      : undefined,
    tags: { app: app },
    platform: 'javascript',
    environment: env || 'ENV',
    server_name: `${app}-${env || 'ENV'}`,
    timestamp: Date.now() / 1000,
    request:
      request && request.url
        ? {
            method: request.method,
            url: request.url,
            query_string: new URL(request.url).search,
            headers: request.headers,
            data: request.body,
          }
        : undefined,
    release,
  }
}

function parse(err: Error) {
  return (err.stack || '')
    .split('\n')
    .slice(1)
    .map((line: string) => {
      if (line.match(/^\s*[-]{4,}$/)) {
        return { filename: line }
      }

      const lineMatch = line.match(/at (?:(.+)\s+\()?(?:(.+?):(\d+)(?::(\d+))?|([^)]+))\)?/)
      if (!lineMatch) {
        return
      }

      return {
        function: lineMatch[1] || undefined,
        filename: lineMatch[2] || undefined,
        lineno: +lineMatch[3] || undefined,
        colno: +lineMatch[4] || undefined,
        in_app: lineMatch[5] !== 'native' || undefined,
      }
    })
    .filter(Boolean)
}

function uuidv4() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return [...bytes].map(b => ('0' + b.toString(16)).slice(-2)).join('') // to hex
}
