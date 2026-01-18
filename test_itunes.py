import asyncio
from src.api_clients.itunes import itunes_client

async def main():
    print("Testing iTunes Audiobooks...")
    results = await itunes_client.search_book("Harry Potter")
    print(f"iTunes Found {len(results)} items")
    if results:
        first = results[0]
        print(f"First item: {first.get('collectionName')} by {first.get('artistName')}")
        print(f"Poster: {first.get('artworkUrl100')}")

if __name__ == "__main__":
    asyncio.run(main())
