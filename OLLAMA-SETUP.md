# Configuración de Ollama - IA Local y Gratuita

## ¿Qué es Ollama?

Ollama es una herramienta que permite ejecutar modelos de IA directamente en tu computadora, sin necesidad de conexión a internet ni límites de tokens.

## Requisitos

- **RAM**: Mínimo 8GB (recomendado 16GB)
- **Disco**: 4-8GB por modelo
- **GPU** (opcional): NVIDIA con CUDA para mayor velocidad

## Instalación

### Windows
1. Descargar de: https://ollama.com/download/windows
2. Ejecutar el instalador
3. Abrir PowerShell y verificar: `ollama --version`

### macOS
```bash
brew install ollama
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

## Modelos Recomendados

### Para Auditoría de Mantenimiento (Español)

| Modelo | RAM | Velocidad | Calidad | Comando |
|--------|-----|-----------|---------|---------|
| **gemma2:9b** | 8GB | Rápida | Buena | `ollama pull gemma2:9b` |
| **llama3.1:8b** | 8GB | Rápida | Buena | `ollama pull llama3.1:8b` |
| **mistral:7b** | 6GB | Muy rápida | Media | `ollama pull mistral:7b` |
| **qwen2.5:7b** | 6GB | Rápida | Buena (Español) | `ollama pull qwen2.5:7b` |

### Recomendación Principal
```bash
ollama pull qwen2.5:7b
```
Qwen2.5 tiene excelente soporte para español y es eficiente con recursos.

## Configuración en la App

1. Abrir la aplicación de Auditoría
2. Ir a "Configurar IA"
3. Seleccionar proveedor: **Ollama**
4. Base URL: `http://localhost:11434/v1` (default)
5. Modelo: `qwen2.5:7b` (o el que instalaste)
6. API Key: No necesaria (dejar vacío)

## Iniciar Ollama

```bash
# Iniciar el servidor (debe estar corriendo)
ollama serve

# En otra terminal, verificar que funciona
curl http://localhost:11434/api/tags
```

## Optimización de Rendimiento

### Usar GPU (NVIDIA)
```bash
# Verificar CUDA
nvidia-smi

# Ollama detecta automáticamente la GPU
# No necesita configuración adicional
```

### Ajustar contexto
```bash
# Crear Modelfile personalizado
echo 'FROM qwen2.5:7b
PARAMETER num_ctx 4096' > Modelfile

# Crear modelo personalizado
ollama create auditor -f Modelfile
```

## Comparación de Costos

| Proveedor | Costo por 1M tokens | Límite |
|-----------|---------------------|--------|
| Groq (gratuito) | $0 | 14,400 tokens/día |
| Groq (pago) | $0.05-0.50 | Sin límite |
| OpenAI | $0.50-5.00 | Sin límite |
| **Ollama** | **$0** | **Sin límite** |

## Solución de Problemas

### "Connection refused"
```bash
# Verificar que Ollama está corriendo
ollama list

# Reiniciar servicio
ollama serve
```

### Respuestas lentas
- Usar modelo más pequeño (mistral:7b)
- Cerrar otras aplicaciones
- Usar GPU si está disponible

### Respuestas incorrectas
- Probar otro modelo
- Ajustar temperatura en la app (0.1-0.3)
- Verificar que el modelo soporta español

## Comandos Útiles

```bash
# Listar modelos instalados
ollama list

# Ver modelos disponibles
ollama search

# Eliminar modelo
ollama rm modelo

# Actualizar modelo
ollama pull modelo
```
