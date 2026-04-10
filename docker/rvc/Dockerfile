FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .

# Install system dependencies and Python packages in a single layer
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir rvc-python==0.1.5

COPY server.py .

VOLUME ["/models"]

EXPOSE 5050

CMD ["python", "server.py"]
