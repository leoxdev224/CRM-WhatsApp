# Recepción experimental con WhatsApp Web

Los eventos llegan por la sesión de WhatsApp Web de cada canal. Esta integración no utiliza webhooks de Meta ni verifica su firma: no satisface los criterios de una integración oficial. La conexión se asocia a la organización y el canal registrados y solo se procesan eventos cuando se acepta la identidad del número.

Se guardan mensajes entrantes y salientes de chats individuales y grupos, su identificador externo, canal, dirección y fecha. En grupos se guarda el identificador del remitente cuando WhatsApp lo proporciona; no se crea un contacto para el grupo. Se admiten textos y las leyendas de imágenes, videos y documentos. Se registra el tipo de audio, sticker, ubicación y contacto, pero no se descargan archivos ni se guarda el contenido completo de ubicación o contacto. Otros formatos y eventos se descartan. Tampoco se implementan edición, eliminación o la sincronización completa del historial.

Los estados numéricos admitidos son pendiente (1), aceptado por el servidor (2), entregado (3), leído (4) y reproducido (5). Se conserva el estado más avanzado aunque los eventos lleguen fuera de orden; si el mensaje todavía no existe, se espera a que llegue. No se modelan errores de envío ni estados por participante de grupo.

Los eventos normalizados se insertan en PostgreSQL y se procesan en transacciones; una restricción evita mensajes duplicados por canal. Los eventos fallidos se reintentan hasta cinco veces, con 30 segundos entre intentos. El código de error se registra sin contenido del mensaje. Una vez procesado, se borra el contenido de la cola; los eventos fallidos conservan datos personales y requieren protección y una política de retención.

Para revisar el estado de los eventos, una persona administradora de la base puede consultar `id`, `channel_account_id`, `attempts` y `error_code` de `whatsapp_message_events` con `status = 'failed'`. Tras corregir la causa, puede reintentar **un evento concreto** usando su id:

```sql
UPDATE whatsapp_message_events
SET status = 'pending', attempts = 0, next_attempt_at = now(), error_code = NULL
WHERE id = <ID_DEL_EVENTO> AND status = 'failed';
```

Si PostgreSQL no está disponible al recibir un evento, o el proceso se detiene antes de guardarlo, el evento podría perderse: no existe confirmación durable ni garantía de reenvío de WhatsApp Web. Las conexiones deben restaurarse manualmente tras reiniciar el servidor. La bandeja permite consultar el historial guardado y responder con texto desde la línea correspondiente; la descarga y el envío de archivos quedan para trabajos posteriores. Esta integración no oficial es experimental y requiere validación adicional antes de usarse en producción.

Cada respuesta se registra con un identificador único antes de intentar enviarla. Una solicitud repetida con ese identificador no se vuelve a transmitir. Si se interrumpe la operación, el resultado puede quedar sin confirmar: no se reenvía automáticamente y se debe revisar WhatsApp antes de repetirla. «Enviado, pendiente de confirmación» indica que la biblioteca terminó el intento, no que el destinatario lo haya recibido; los estados posteriores dependen de los eventos que WhatsApp Web entregue. Las reglas de ventana de atención y plantillas de la API oficial no están implementadas ni verificadas por esta conexión no oficial.
