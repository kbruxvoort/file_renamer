import httpx
from typing import Dict, Any
from src.api_clients.retry import api_retry

class GoogleBooksClient:
    BASE_URL = "https://www.googleapis.com/books/v1/volumes"

    @api_retry
    async def search_book(self, query: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = {"q": query}
            response = await client.get(self.BASE_URL, params=params)
            response.raise_for_status()
            return response.json()

books_client = GoogleBooksClient()
