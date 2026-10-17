import httpx
from typing import Dict, Any, List
from src.api_clients.retry import api_retry

class ITunesAudiobookClient:
    """Client for iTunes Search API (Audiobooks)"""
    BASE_URL = "https://itunes.apple.com/search"

    @api_retry
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
