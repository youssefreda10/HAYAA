import modal
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import os

# Define FastAPI app
web_app = FastAPI(title="Hayā API")

# Configure CORS to allow the extension to call this API
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class RequestPayload(BaseModel):
    inputs: List[str]

# Define Modal environment image
image = (
    modal.Image.debian_slim()
    .pip_install("transformers", "torch", "huggingface_hub", "fastapi[standard]")
)

# Define Modal App
app = modal.App("haya-text-classifier", image=image)

# Define the Model class
@app.cls(image=image, cpu=1.0, secrets=[modal.Secret.from_name("huggingface-secret")])
class Classifier:
    @modal.enter()
    def load_model(self):
        from transformers import pipeline
        # Load model using the HuggingFace token
        # top_k=None ensures it returns all labels with their probabilities
        self.classifier = pipeline(
            "text-classification", 
            model="youssefreda9/HAYAA", 
            token=os.environ.get("HF_TOKEN"),
            top_k=None 
        )

    @modal.method()
    def classify(self, texts: List[str]):
        # The pipeline accepts a list of strings directly
        return self.classifier(texts)

# Define the endpoint route
@web_app.post("/")
def classify_text(payload: RequestPayload):
    classifier = Classifier()
    # Call the remote method synchronously
    results = classifier.classify.remote(payload.inputs)
    return results

# Expose the FastAPI app
@app.function()
@modal.asgi_app()
def fastapi_app():
    return web_app
