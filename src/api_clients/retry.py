import httpx
from tenacity import retry, retry_if_exception, stop_after_attempt, wait_exponential


class MissingApiKeyError(RuntimeError):
    """Raised when a metadata provider needs an API key that isn't configured."""


def _is_retryable(exc: BaseException) -> bool:
    """Retry network failures, rate limits and server errors; not 4xx like a bad API key."""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        return status == 429 or status >= 500
    return isinstance(exc, httpx.TransportError)


# reraise=True surfaces the original error instead of tenacity's RetryError
api_retry = retry(
    retry=retry_if_exception(_is_retryable),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10),
    reraise=True,
)
