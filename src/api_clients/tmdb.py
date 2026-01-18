import httpx
from typing import Optional, Dict, Any
from src.config import config
from tenacity import retry, stop_after_attempt, wait_exponential

class TMDBClient:
    BASE_URL = "https://api.themoviedb.org/3"

    def __init__(self):
        self.api_key = config.TMDB_API_KEY
        if not self.api_key:
             # We might want to raise here or handle it gracefully depending on usage
             pass
        self.headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        # If using query param for v3:
        self.params = {"api_key": self.api_key}

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_movie(self, query: str, year: Optional[int] = None) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = self.params.copy()
            params["query"] = query
            if year:
                params["year"] = year
            
            response = await client.get(f"{self.BASE_URL}/search/movie", params=params)
            response.raise_for_status()
            return response.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def search_tv(self, query: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = self.params.copy()
            params["query"] = query
            
            response = await client.get(f"{self.BASE_URL}/search/tv", params=params)
            response.raise_for_status()
            return response.json()

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def get_episode_details(self, tv_id: int, season_number: int, episode_number: int) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = self.params.copy()
            url = f"{self.BASE_URL}/tv/{tv_id}/season/{season_number}/episode/{episode_number}"
            
            response = await client.get(url, params=params)
            # 404 means episode not found (e.g. S01E99), just return empty dict or raise?
            # raising allows retry logic to fail, but here 404 is likely permanent.
            if response.status_code == 404:
                return {}
            
            response.raise_for_status()
            return response.json()

# Global instance
tmdb_client = TMDBClient()
