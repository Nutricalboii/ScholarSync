🎓 ScholarSync: The AI-Powered "Second Brain" for Students
ScholarSync is an advanced educational ecosystem that transforms static, disconnected PDFs into an interactive, interconnected knowledge base. Built for the TechSprint Hackathon, it leverages Google Gemini 2.0 Flash to help students synthesize information across their entire library of notes and textbooks simultaneously.

🚀 **Live Demo:** [https://scholarsync-nutricalboii.vercel.app](https://scholarsync-nutricalboii.vercel.app)
⚙️ **Backend API:** [https://scholarsync-jh4j.onrender.com](https://scholarsync-jh4j.onrender.com)

📺 Project Overview
The Problem: Students suffer from "Information Silos"—knowledge is trapped in separate PDFs, making it hard to see the "big picture" across different subjects.

The Solution: ScholarSync uses multimodal RAG to analyze your entire library at once, identifying cross-document connections and generating visual, interactive study aids.

🌟 Key Features
🧠 Multi-Document Synthesis
Chat with your entire library. ScholarSync doesn't just answer questions; it cites specific files and page numbers, ensuring academic integrity.

🕸️ Interactive Knowledge Graph
A visual map of your education. Concept nodes are extracted using Gemini and linked together. Click a node to trigger an instant AI deep-dive into that topic.

🃏 3D Active Recall Tools
3D Flashcards: Automatically generated study cards with smooth CSS-3D flip animations.

Smart Quizzing: Dynamic MCQ generation with instant feedback and logic explanations.

🗺️ Structured Learning Paths
AI-generated roadmaps that guide you through complex subjects in a logical order based on your specific materials.

🛠️ Technical Architecture
ScholarSync uses a modern decoupled architecture optimized for the Google Cloud Ecosystem.

Frontend: Next.js 14, Tailwind CSS (Dark/Light Mode), Framer Motion (Animations).

Backend: FastAPI (Python 3.10+), ChromaDB (Vector Store), PyPDF.

AI Engine:

LLM: gemini-2.0-flash for high-speed reasoning and structured JSON output.

Embeddings: text-embedding-004 for superior semantic search accuracy.

🛡️ Google Technology Integration
This project is built from the ground up to showcase the power of Google’s AI stack:

Gemini 2.0 Flash: Utilized for its massive context window and multimodal capabilities, allowing the system to "read" multiple textbooks at once.

Google AI Studio: Used for rapid prototyping and fine-tuning system instructions.

Firebase (Optional): Provides a scalable foundation for future user authentication and cloud document storage.

💻 Installation & Setup
Prerequisites
Python 3.10+

Node.js 18+

Google Gemini API Key

1. Backend Setup
Bash

cd backend
python -m venv venv
# On Windows: .\venv\Scripts\activate | On Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
Create a .env file in the backend folder:

Code snippet

GEMINI_API_KEY=your_api_key_here
Start the API: python main.py

2. Frontend Setup
Bash

cd frontend
npm install
npm run dev
Access the dashboard at http://localhost:3000.

🤝 Roadmap & Future Scalability
[ ] Voice-to-Sync: Integrate Google Speech-to-Text for live lecture note-taking.

[ ] Collaborative Knowledge Graphs: Allow study groups to merge their libraries.

[ ] Mobile Integration: A Flutter-based mobile app for on-the-go flashcard review.

🏆 Submission Details
Event: TechSprint Hackathon

Category: Open Innovation (Education)

Team: Solo Developer - Vaibhav Sharma / Nutricalboii (GitHub Handle)
