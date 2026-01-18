
import asyncio
from src.api_clients.books import books_client
from src.api_clients.audnexus import audnexus_client

async def test_books():
    print("Testing Google Books...")
    try:
        res = await books_client.search_book("Harry Potter")
        items = res.get('items', [])
        print(f"Google Books Found {len(items)} items")
        if items:
            print(f"First item: {items[0].get('volumeInfo', {}).get('title')}")
    except Exception as e:
        print(f"Google Books Error: {e}")

async def test_audiobooks():
    print("\nTesting Audnexus...")
    try:
        res = await audnexus_client.search_book("Harry Potter")
        # Handle list or dict return
        books = res if isinstance(res, list) else res.get('books', [])
        print(f"Audnexus Found {len(books)} items")
        if books:
            print(f"First item: {books[0].get('title')}")
    except Exception as e:
        print(f"Audnexus Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_books())
    asyncio.run(test_audiobooks())
