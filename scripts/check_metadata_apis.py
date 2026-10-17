"""
Manual smoke check for the book/audiobook metadata providers (hits the real APIs).

    uv run python -m scripts.check_metadata_apis
"""
import asyncio

from src.api_clients.books import books_client
from src.api_clients.itunes import itunes_client


async def main():
    print("Testing Google Books...")
    try:
        res = await books_client.search_book("Harry Potter")
        items = res.get('items', [])
        print(f"Google Books found {len(items)} items")
        if items:
            print(f"First item: {items[0].get('volumeInfo', {}).get('title')}")
    except Exception as e:
        print(f"Google Books error: {e}")

    print("\nTesting iTunes Audiobooks...")
    try:
        results = await itunes_client.search_book("Harry Potter")
        print(f"iTunes found {len(results)} items")
        if results:
            first = results[0]
            print(f"First item: {first.get('collectionName')} by {first.get('artistName')}")
    except Exception as e:
        print(f"iTunes error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
