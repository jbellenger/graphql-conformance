FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir "graphql-core>=3.2.3,<3.3"
RUN python -c "import importlib.metadata as m; print(m.version('graphql-core'))" > /impl-version
COPY server.py /app/server.py

EXPOSE 8080
CMD ["python3", "server.py"]
