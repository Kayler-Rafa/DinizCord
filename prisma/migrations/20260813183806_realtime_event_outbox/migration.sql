-- CreateTable
CREATE TABLE "RealtimeEvent" (
    "id" BIGSERIAL NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RealtimeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RealtimeEvent_createdAt_idx" ON "RealtimeEvent"("createdAt");

-- Notificação automática do outbox.
--
-- Publicar um evento realtime passa a ser apenas um INSERT: o trigger avisa
-- todas as instâncias do gateway que estão em LISTEN no canal. Só o id viaja no
-- NOTIFY (o limite dele é de 8000 bytes); cada instância busca a linha.
CREATE OR REPLACE FUNCTION dinizcord_notify_realtime_event() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('dinizcord_events', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER realtime_event_notify
AFTER INSERT ON "RealtimeEvent"
FOR EACH ROW
EXECUTE FUNCTION dinizcord_notify_realtime_event();
