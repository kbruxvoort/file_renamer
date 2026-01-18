import httpx
from typing import Dict, Any, List
from tenacity import retry, stop_after_attempt, wait_exponential

class ITunesAudiobookClient:
    """Client for iTunes Search API (Audiobooks)"""
    BASE_URL = "https://itunes.apple.com/search"

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_book(self, query: str) -> List[Dict[str, Any]]:
        """Search for audiobooks."""
        async with httpx.AsyncClient() as client:
            params = {
                "term": query,
                "media": "audiobook",
                "entity": "audiobook",
                "limit": 5
            }
            response = await client.get(self.BASE_URL, params=params)
            response.raise_for_status()
            data = response.json()
            
            return data.get("results", [])

# Global instance
itunes_client = ITunesAudiobookClient()
