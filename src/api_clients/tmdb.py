import httpx
from typing import Optional, Dict, Any
from src.config import config
from src.api_clients.retry import api_retry, MissingApiKeyError

class TMDBClient:
    BASE_URL = "https://api.themoviedb.org/3"

    @property
    def params(self) -> Dict[str, Any]:
        # Read on every request so a key saved in Settings applies without a restart
        api_key = config.TMDB_API_KEY
        if not api_key:
            raise MissingApiKeyError("TMDB API key is not set. Add it in Settings.")
        return {"api_key": api_key}

    async def validate_key(self, api_key: str) -> Optional[bool]:
        """True/False if TMDB accepts/rejects the key; None if TMDB couldn't be reached."""
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.get(f"{self.BASE_URL}/configuration", params={"api_key": api_key})
        except httpx.HTTPError:
            return None
        if response.status_code == 401:
            return False
        return response.is_success or None

    @api_retry
    async def search_movie(self, query: str, year: Optional[int] = None) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = self.params.copy()
            params["query"] = query
            if year:
                params["year"] = year
            
            response = await client.get(f"{self.BASE_URL}/search/movie", params=params)
            response.raise_for_status()
            return response.json()

    @api_retry
    async def search_tv(self, query: str) -> Dict[str, Any]:
        async with httpx.AsyncClient() as client:
            params = self.params.copy()
            params["query"] = query
            
            response = await client.get(f"{self.BASE_URL}/search/tv", params=params)
            response.raise_for_status()
            return response.json()

    @api_retry
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

    @api_retry
    async def get_season_details(self, tv_id: int, season_number: int) -> Dict[str, Any]:
        """Fetch details for an entire season (including all episodes)"""
        async with httpx.AsyncClient() as client:
            params = self.params.copy()
            url = f"{self.BASE_URL}/tv/{tv_id}/season/{season_number}"
            
            response = await client.get(url, params=params)
            if response.status_code == 404:
                return {}
            
            response.raise_for_status()
            return response.json()

# Global instance
tmdb_client = TMDBClient()
