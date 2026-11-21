run:
	uvicorn app.main:app --reload
fmt:
	isort . && black . && ruff check --fix .
lint:
	ruff check . && black --check . && isort --check .
test:
	pytest
migrate:
	alembic upgrade head
revision:
	alembic revision --autogenerate -m "$(m)"
