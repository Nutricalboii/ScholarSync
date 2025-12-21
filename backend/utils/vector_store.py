import chromadb
from chromadb.config import Settings
import os
from .gemini_client import get_embeddings

class VectorStore:
    def __init__(self):
        # Use a local directory for persistence
        persist_directory = os.path.join(os.getcwd(), "chroma_db")
        self.client = chromadb.PersistentClient(path=persist_directory)
        
        # Create or get the collection
        self.collection = self.client.get_or_create_collection(
            name="study_materials",
            metadata={"hnsw:space": "cosine"}
        )

    def add_documents(self, texts: list[str], metadatas: list[dict], ids: list[str]):
        """Adds documents to the vector store with embeddings."""
        if not texts:
            return
            
        embeddings = get_embeddings(texts)
        self.collection.add(
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas,
            ids=ids
        )

    def query(self, query_text: str, n_results: int = 5):
        """Queries the vector store for similar documents."""
        query_embeddings = get_embeddings([query_text])
        results = self.collection.query(
            query_embeddings=query_embeddings,
            n_results=n_results
        )
        return results

    def clear_all(self):
        """Clears all documents from the collection."""
        ids = self.collection.get()["ids"]
        if ids:
            self.collection.delete(ids=ids)

    def delete_file(self, filename: str):
        """Deletes all documents associated with a specific filename."""
        # Query for IDs with the matching filename in metadata
        results = self.collection.get(where={"filename": filename})
        if results and results["ids"]:
            self.collection.delete(ids=results["ids"])

# Global instance
vector_store = VectorStore()
