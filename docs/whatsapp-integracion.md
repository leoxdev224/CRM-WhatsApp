# Integración oficial de WhatsApp: investigación inicial

> **Cambio de dirección solicitado:** se evaluará WhatsApp Web con vinculación por QR para reducir costos por mensaje. Esto sustituye la preferencia anterior de integración directa con la API oficial. La integración automática con WhatsApp Web sería no oficial y requiere evaluar su estabilidad, términos y protección de sesiones antes de usar números reales. El texto de Cloud API más abajo queda como referencia, no como decisión vigente.

Revisión: 12 de noviembre de 2026. Esta investigación no registra números ni habilita conexiones reales.

## Opciones para CityWin

- **Cloud API directa:** Meta aloja la API; CityWin necesita acceso a los activos y credenciales de su cuenta empresarial. El CRM es responsable de la integración, el mantenimiento y la operación.
- **Proveedor oficial:** el proveedor puede facilitar el alta y la operación, con condiciones, costos y alcance propios. Confirmar por contrato coexistencia, exportación de datos, soporte y qué ocurre al desconectar.

**Decisión anterior, reemplazada:** investigar conexión directa con Meta. El diseño multiempresa del CRM no implica que Embedded Signup esté disponible automáticamente: la colección oficial de Meta lo describe como un flujo para Solution Partners, Tech Providers y Tech Partners, con requisitos de revisión y permisos. [Meta: Embedded Signup](https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup)

## Alternativa solicitada: WhatsApp Web

La API oficial no interviene en una integración basada en WhatsApp Web. Para reunir chats automáticamente en una bandeja propia haría falta una integración no oficial, distinta de usar WhatsApp Web manualmente. Puede dejar de funcionar si cambia el servicio y expone la cuenta a restricciones. Las credenciales de sesión y los códigos QR permiten vincular dispositivos y deben protegerse como secretos.

WhatsApp limita el acceso y la automatización no autorizados y sus normas mencionan clientes no oficiales y mensajería masiva. [Condiciones de WhatsApp](https://www.whatsapp.com/legal/terms-of-service?format=rss&lang=en) · [Normas de mensajería](https://www.whatsapp.com/legal/messaging-guidelines?lang=mk&trk=public_post_comment-text)

Todavía no se ha incorporado una biblioteca, conectado ninguna cuenta ni verificado importación de historial. Hay que definir el alcance de uso, evaluar dependencias y probar con un número de prueba antes de vincular números relevantes del negocio.

## Requisitos y permisos

Para Cloud API se necesita una app de Meta, una cuenta de WhatsApp Business (WABA), números autorizados e identificadores de sus activos. Los permisos habituales son `whatsapp_business_management` y `whatsapp_business_messaging`; algunas operaciones de negocio pueden requerir `business_management`. La disponibilidad efectiva debe verificarse en la cuenta y app reales. [Meta: Cloud API](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)

El acceso de prueba no prueba que el negocio esté habilitado para producción, otros negocios o coexistencia. Antes del piloto hay que validar revisión, permisos, propiedad de activos, facturación y condiciones aplicables en Meta.

## Coexistencia, QR e historial

No se ha verificado aún que los números de CityWin sean elegibles para coexistencia ni qué flujo de alta estará disponible para ellos. Un QR solo se mostrará si el flujo oficial elegido lo requiere y Meta lo presenta. No se asumirá que cualquier cuenta personal pueda conectarse por QR.

La disponibilidad de importación de contactos e historial, su alcance y las restricciones de adjuntos y grupos quedan por confirmar con la documentación vigente y el flujo elegido. No se promete importar el historial completo.

## Costos

Meta publica precios por mensaje entregado, que dependen del mercado del destinatario y de la categoría. Consultar las tarifas vigentes y condiciones de la cuenta antes de enviar; no hay presupuesto exacto sin mercados, categorías y volumen. Un proveedor puede agregar cargos propios. [WhatsApp: precios oficiales](https://whatsappbusiness.com/products/platform-pricing/)

## Seguridad y revocación

- Solo administradores autorizados de cada organización pueden administrar canales.
- Los tokens deben permanecer en el servidor, protegidos y fuera de Git, respuestas y logs. Gestionar rotación y mínimo privilegio.
- La desconexión local debe impedir nuevos envíos y accesos con esa conexión. Distinguirla de revocar permisos en Meta: el mecanismo real depende de la integración seleccionada y de cómo se comparta la credencial.
- Registrar acciones sensibles sin registrar credenciales; comprobar estado real y errores sin presentarlos como conexión activa por defecto.

## Siguiente validación

1. Revisar el cambio de alcance del ticket 05: conexión no oficial mediante QR y sus riesgos.
2. Evaluar una biblioteca y la protección de sesiones por organización y cuenta.
3. Comprobar importación, límites, baja y recuperación con un número de prueba.
4. Mantener las credenciales de sesión fuera del repositorio, respuestas y registros.
