# Code Practices

How code in this repo should look. Short on purpose: follow it, and update it when the team agrees on something new.

## General
- **DRY, but not too early.** Extract shared logic once it appears a second or third time. Don't build abstractions for a single use.
- **Simple over clever.** The minimum code that solves the problem. No speculative features or configuration.
- **Small, single-purpose functions.** If you need "and" to describe what one does, split it.
- **Names explain intent.** `get_active_users`, not `proc` or `data2`.
- **Comments explain why, not what.** The code and docstrings already say what.
- **Handle errors at the boundary.** Validate input in schemas and routers; don't scatter defensive checks for impossible cases.
- **No secrets in code.** Config lives in `app/config.py` and `.env`.
- **Match the surrounding style.** Don't reformat or refactor code you aren't changing.

## Python (backend)
- **Type hints everywhere** (parameters and return types). Use `X | None`, not `Optional[X]`.
- **Docstrings** on every public module, class and function, in Google style. Say what it does, `Args`, `Returns`, and `Raises` when relevant. Skip restating the obvious on tiny helpers (one line is fine).
- **Layering:** routers handle HTTP only, schemas define request/response shapes, models define tables. Shared logic goes in a service or helper module, not copied between routers.
- **Dependencies** use `Annotated[..., Depends(...)]`.
- **Async all the way:** use `async def` with the async session; never block the event loop.
- **DB changes** need an Alembic migration in the same commit as the model change.
- Formatting and imports are enforced by `make fmt` and `make lint` (black, isort, ruff).

```python
async def get_item(session: AsyncSession, item_id: int) -> Item:
    """Fetch a single item.

    Args:
        session: Active database session.
        item_id: Primary key of the item.

    Returns:
        The matching item.

    Raises:
        HTTPException: 404 if no item has that id.
    """
```

## TypeScript (frontend)
- **`strict` mode on; no `any`.** Use `unknown` and narrow, or define a type.
- **TSDoc** (`/** ... */`) on exported functions, components, hooks and types, with `@param` and `@returns`. Don't repeat types in the comment, since TypeScript already has them.
- **Share types** between components in one place instead of redefining them. Prefer types generated from the API schema over hand-written copies.
- **Small components and hooks.** Pull repeated UI or logic into a shared component or hook.
- **Named exports** over default exports; one main component per file.

```ts
/**
 * Fetch a single item from the API.
 *
 * @param id - Primary key of the item.
 * @returns The matching item.
 * @throws If the API responds with a non-2xx status.
 */
export async function getItem(id: number): Promise<Item> { ... }
```

## Before opening a PR
- `make lint` and `make test` pass.
- New behavior has a test.
- No duplicated logic, dead code, or leftover debug prints.
- New config is in `backend/.env.example`.
