from app.crud import crud_router
from app.models import Notification
from app.schemas.notification import NotificationCreate, NotificationRead

router = crud_router(
    "/notifications", Notification, NotificationCreate, NotificationRead
)
