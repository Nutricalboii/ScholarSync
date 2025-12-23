import chromadb
from chromadb.config import Settings
import os
from .gemini_client import get_embeddings

class VectorStore:
    def __init__(self):
        # Use a local directory for persistence
        persist_directory = os.path.join(os.getcwd(), "chroma_db")
        # Optimize settings for Render Free Tier (low RAM)
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(
                chroma_segment_cache_policy="LRU",
                # Limit cache to ~150MB to stay within Render's 512MB limit
                chroma_memory_limit_bytes=150000000
            )
        )

    def _get_collection(self, name: str):
        """Helper to get or create a collection with optimized settings."""
        # Sanitize name: ChromaDB requires 3-63 chars, alphanumeric, starts/ends with alphanumeric
        # It also allows underscores and hyphens.
        safe_name = name.replace(".", "_").replace(" ", "_")
        if len(safe_name) < 3: safe_name = f"user_{safe_name}"
        if len(safe_name) > 63: safe_name = safe_name[:63]
        
        return self.client.get_or_create_collection(
            name=safe_name,
            metadata={
                "hnsw:space": "cosine",
                "hnsw:construction_ef": 100,
                "hnsw:M": 16,
                "hnsw:search_ef": 50
            }
        )

    def add_documents(self, collection_name: str, texts: list[str], metadatas: list[dict], ids: list[str]):
        """Adds documents to the vector store with embeddings in batches."""
        if not texts:
            return
            
        collection = self._get_collection(collection_name)
        batch_size = 50 # Safe batch size for Gemini embedding limits and memory
        
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i:i + batch_size]
            batch_metadatas = metadatas[i:i + batch_size]
            batch_ids = ids[i:i + batch_size]
            
            batch_embeddings = get_embeddings(batch_texts)
            
            collection.add(
                embeddings=batch_embeddings,
                documents=batch_texts,
                metadatas=batch_metadatas,
                ids=batch_ids
            )

    def query(self, collection_name: str, query_text: str, n_results: int = 5):
        """Queries the vector store for similar documents."""
        collection = self._get_collection(collection_name)
        query_embeddings = get_embeddings([query_text])
        results = collection.query(
            query_embeddings=query_embeddings,
            n_results=n_results
        )
        return results

    def get_all_materials(self, collection_name: str):
        """Gets unique filenames from the collection."""
        collection = self._get_collection(collection_name)
        results = collection.get(include=["metadatas"])
        if not results or not results["metadatas"]:
            return []
        
        filenames = set()
        for meta in results["metadatas"]:
            if meta and "filename" in meta:
                filenames.add(meta["filename"])
        
        return [{"filename": name} for name in filenames]

    def clear_all(self, collection_name: str):
        """Clears all documents from the collection."""
        collection = self._get_collection(collection_name)
        ids = collection.get()["ids"]
        if ids:
            collection.delete(ids=ids)

    def delete_file(self, collection_name: str, filename: str):
        """Deletes all documents associated with a specific filename."""
        collection = self._get_collection(collection_name)
        # Query for IDs with the matching filename in metadata
        results = collection.get(where={"filename": filename})
        if results and results["ids"]:
            collection.delete(ids=results["ids"])

# Global instance
vector_store = VectorStore()
