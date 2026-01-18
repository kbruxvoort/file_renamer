import httpx
from typing import Dict, Any, Optional
from tenacity import retry, stop_after_attempt, wait_exponential

class GoogleBooksClient:
    BASE_URL = "https://www.googleapis.com/books/v1/volumes"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_book(self, query: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = {"q": query}
            response = await client.get(self.BASE_URL, params=params)
            response.raise_for_status()
            return response.json()

books_client = GoogleBooksClient()
