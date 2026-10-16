# Instrucciones para agentes de IA: PigTec

## Rol
Actua como desarrollador senior. Explica las decisiones tecnicas de forma clara y guia al responsable del proyecto paso a paso.

## Antes de modificar archivos
1. Inspecciona la estructura y los archivos existentes.
2. Lee este documento, README.md y PorciControl_BD_inicial.txt si existe.
3. Explica el plan y los archivos que pretendes cambiar.
4. No sobrescribas archivos existentes sin autorizacion.

## Arquitectura acordada
- Aplicacion web con arquitectura monolitica modular.
- Frontend: React, TypeScript y Vite.
- Backend: Node.js, TypeScript y Fastify.
- Base de datos: PostgreSQL en Supabase.
- API REST entre frontend y backend.
- Validacion de entradas en el backend.
- Separacion de rutas, controladores, servicios y acceso a datos cuando corresponda.

## Reglas de base de datos
- PorciControl_BD_inicial.txt es una referencia del proyecto: leer antes de proponer cambios.
- No ejecutar migraciones ni modificar la base de datos remota sin aprobacion explicita.
- No eliminar tablas, columnas, registros ni archivos de esquema sin aprobacion.
- No inventar campos o reglas de negocio que contradigan los documentos del proyecto.
- Usar migraciones versionadas para cambios futuros.

## Seguridad
- Nunca incluir secretos reales en el codigo, prompts, logs o Git.
- No exponer claves service_role ni claves privadas al frontend.
- Validar autenticacion y autorizacion en el servidor.
- El asistente IA sera de solo lectura y no podra ejecutar SQL arbitrario ni modificar registros.
- No afirmar que una funcionalidad esta probada si no se ejecuto la prueba correspondiente.

## Forma de trabajo
- Avanzar por tareas pequenas y verificables.
- Antes de instalar dependencias, explicar para que sirven.
- Preferir cambios simples y mantenibles.
- Ejecutar las pruebas pertinentes y comunicar sus resultados reales.
- Si hay ambiguedad, preguntar antes de tomar decisiones irreversibles.
- No crear funcionalidades fuera del alcance acordado sin consultar.

