# Seguridad y operación

Esta guía define la política inicial para revisión por el responsable de CityWin antes de usar datos reales. El entorno publicado no existe en este repositorio: no se afirma que HTTPS, copias programadas o eliminación automática estén instalados.

## Acceso y secretos

Administradores y operadores solo acceden a su organización; los operadores pueden ver todas sus conversaciones y notas. Solo administradores con MFA pueden consultar la auditoría mediante `GET /api/audit`; devuelve hasta 100 eventos, en orden descendente. Para continuar, usar `?before=<id>` con el último ID recibido. Los intentos sin autenticación se registran sin organización ni identidad y no se exponen por este endpoint. Las acciones de la consola exigen `CRM_AUDIT_ACTOR_ID` de un administrador activo de la misma organización; la identidad es declarada por quien tiene acceso al servidor, no una sesión autenticada. El acceso al servidor debe restringirse y registrarse por separado.

Los eventos contienen fecha, organización, actor cuando se conoce, tipo, identificador del recurso y estado HTTP, no contraseñas, tokens, QR, teléfonos ni texto de mensajes/notas. Estado 100 significa intento antes de ejecutar una operación; el resultado es otro evento. Un envío 202 indica que se aceptó la operación; su estado de entrega debe consultarse en la conversación. La auditoría del resultado se escribe al responder: si falla, se registra `security_audit_write_failed` y no se revierte una acción ya realizada; ese código debe activar una alerta operativa. Las mutaciones autenticadas se rechazan antes de ejecutarse si no se puede guardar el intento. El registro de cambios de asignación/estado conserva su historial adicional.

La API solo registra códigos genéricos ante errores y no guarda URLs, parámetros ni cuerpos en los logs HTTP. La librería de WhatsApp tiene logging desactivado. Los logs de infraestructura y herramientas externas también deben configurarse para no guardar consultas, cabeceras, cuerpos ni URLs de solicitudes con datos personales. No registrar el comando de alta MFA: muestra el secreto una vez en la consola.

En producción almacenar los secretos fuera del repositorio, con permisos solo para la identidad del servicio. Usar claves distintas, aleatorias y persistentes para MFA, sesiones WhatsApp y copias; guardarlas separadas de las copias, con recuperación probada y rotación controlada. Nunca registrar sus valores. El secreto del proxy TLS y las credenciales PostgreSQL tienen acceso restringido; rotar y revocar ante exposición. `.env.example` contiene valores ficticios solamente.

PostgreSQL no debe tener puertos públicos: usar red privada o socket y firewall, TLS verificado para conexiones que salgan del servidor y credenciales distintas para aplicación, migraciones y copias. El rol de aplicación debe carecer de SUPERUSER, CREATEDB, CREATEROLE y privilegios de administrador; conceder únicamente los accesos requeridos por el esquema. Aplicar migraciones con una identidad de despliegue separada. Proteger y vigilar `security_audit` frente a alteraciones por administradores del servidor; el proceso actual escribe en la misma base y no es un registro inmutable ni externo. Restringir y auditar el acceso al volumen, a los respaldos y a la consola; no usar las credenciales ni el Compose local de desarrollo en producción.

## Publicación HTTPS

La API debe escuchar en loopback/red privada, nunca directamente en Internet. Publicar frontend y `/api` bajo el mismo origen HTTPS mediante un proxy con certificado válido, renovación y redirección de HTTP a HTTPS. [nginx.conf.example](../deploy/nginx.conf.example) es una plantilla: sustituir nombre, certificados y ruta del frontend compilado; validar con `nginx -t`, habilitar el sitio y comprobar renovación y redirección antes de publicar. El proxy no registra solicitudes ni errores para evitar filtrar URLs; la infraestructura debe vigilar disponibilidad y errores con métricas que no contengan datos personales. HSTS solo debe habilitarse para un dominio que ya funcione íntegramente con HTTPS. Proteger el frontend contra XSS y aplicar límites de intentos en infraestructura antes de producción: el token de sesión es accesible al JavaScript de la pestaña.

## Retención, exportación y eliminación

Política propuesta: conservar conversaciones y notas mientras la organización tenga necesidad operativa o exista obligación aplicable; revisar al menos cada 12 meses. Conservar auditoría 12 meses y copias cifradas 30 días, salvo una obligación documentada distinta. No hay eliminación programada ni mecanismos de retención legal en el sistema: el responsable debe aprobar los plazos según jurisdicción, contratos y finalidad, y ejecutar y verificar el proceso administrativo. No borrar registros automáticamente al instalar este cambio.

Las solicitudes de exportación y eliminación se reciben y aprueban por un administrador autorizado de la organización; verificar identidad, alcance, respaldo, obligaciones de conservación y dependencias antes de actuar. Actualmente no existe un exportador ni borrado selectivo en la interfaz: un administrador de base autorizado debe preparar un extracto limitado por `organization_id`, revisar que no incluya credenciales, sesiones, QR ni datos de terceros, cifrarlo y entregarlo por canal seguro. Registrar quién autorizó y ejecutó la operación, fecha, alcance y destino sin copiar el contenido al registro. La exportación paginada de auditoría usa el endpoint descrito arriba; la copia de base **no** sirve como exportación de una organización porque incluye todas las organizaciones y secretos cifrados.

Para eliminación selectiva debe planificarse una operación transaccional y verificada sobre las tablas relacionadas y el canal correspondiente; la estructura actual tiene restricciones de integridad y no ofrece borrado seguro con un botón. Documentar qué se elimina y qué se retiene. Las copias anteriores pueden conservar el dato hasta su vencimiento; si se restaura una copia anterior se deben reaplicar las eliminaciones aprobadas antes de reabrir el servicio. No ejecutar borrados masivos sin respaldo y autorización.

## Copia cifrada y recuperación

`scripts/backup.mjs` funciona con PostgreSQL dentro de un contenedor Docker ya existente. Produce un dump consistente `pg_dump -Fc` cifrado con AES-256-GCM; la clave debe tener 64 dígitos hexadecimales y guardarse en un gestor de secretos separado. Usar una identidad de base autorizada para leer los datos necesarios sin privilegios de superusuario. La copia incluye todas las organizaciones, hashes y sesiones cifradas. Aplicar ACL restrictivas a directorios de copia y temporal (en Windows, las ACL del directorio deben limitarse al usuario de servicio); modo 0600 por sí solo no garantiza ACL en Windows. Mantener copias cifradas fuera del servidor y verificar la restauración periódicamente. Respaldar por separado las claves persistentes de MFA y WhatsApp: sin ellas una copia de base no permite descifrar esos secretos.

Ejemplo PowerShell, con valores a reemplazar y una clave cargada desde un gestor seguro (no escribirla en historial ni compartirla):

```powershell
$env:CRM_BACKUP_KEY = Read-Host 'Clave de copia hexadecimal' -MaskInput
node scripts/backup.mjs backup CONTENEDOR USUARIO BASE C:\ruta-segura\crm.crmbackup
Remove-Item Env:CRM_BACKUP_KEY
```

El archivo debe terminar en `.crmbackup` (ignorado por Git) y el destino debe ser nuevo; no se sobrescribe una copia existente. Probar con una base de destino distinta, vacía y cuyo nombre termine en `_restore`, creada expresamente por un administrador. La herramienta valida el cifrado antes de iniciar `pg_restore`, usa una transacción y no acepta un destino con tablas u otros objetos. Durante la validación crea temporalmente un dump **sin cifrar** en el directorio temporal privado del usuario y trata de borrarlo después, incluso si falla. Preparar ese directorio en un volumen cifrado y con ACL restringidas; borrarlo no garantiza eliminación física. Nunca usar una base de producción como destino de la prueba. Verificar integridad y cantidades, guardar fecha y resultado, luego eliminar solo la base temporal creada para la prueba:

```powershell
$env:CRM_BACKUP_KEY = Read-Host 'Clave de copia hexadecimal' -MaskInput
node scripts/backup.mjs restore CONTENEDOR USUARIO crm_prueba_restore C:\ruta-segura\crm.crmbackup
Remove-Item Env:CRM_BACKUP_KEY
```

Programar la copia diaria y su verificación con el planificador y supervisión del entorno de despliegue; el proyecto no instala ni configura ese servicio. Alertar fallos, aplicar el vencimiento aprobado de 30 días y ensayar una restauración aislada al menos mensualmente y después de cambios relevantes. Proteger también las copias externas y comprobar que pueden recuperarse la clave y las sesiones cifradas. No restaurar sesiones ni conectar el WhatsApp real desde el entorno de prueba.
