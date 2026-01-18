import httpx
from typing import Dict, Any, List
from tenacity import retry, stop_after_attempt, wait_exponential

class AudnexusClient:
    """Client for Audnexus (Audiobook) API"""
    BASE_URL = "https://api.audnex.us"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_book(self, query: str) -> Dict[str, Any]:
        """Search for audiobooks."""
        async with httpx.AsyncClient() as client:
            # Audnexus uses /books with a query param 'q' or 'title'
            # Based on common usage, searching by text
            response = await client.get(f"{self.BASE_URL}/books", params={"q": query})
            
            if response.status_code == 404:
                return {}
            
            response.raise_for_status()
            return response.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_by_id(self, book_id: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.BASE_URL}/books/{book_id}")
            response.raise_for_status()
            return response.json()

# Global instance
audnexus_client = AudnexusClient()
