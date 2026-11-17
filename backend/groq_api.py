"""Groq response handling without exposing provider prompts or credentials."""
import json
import hashlib
import time
import logging

_model_cache = {}
_logger = logging.getLogger(__name__)


def error_code(response):
    try:
        error = response.json().get('error', {})
        return error.get('code') or error.get('type') or ''
    except (ValueError, AttributeError):
        return ''


def check_response(response):
    if response.status_code == 200:
        return
    code = error_code(response)
    if response.status_code == 401:
        message = 'The Groq API key was not accepted. Update GROQ_API_KEY in .env and restart the app.'
    elif response.status_code == 429:
        message = 'Groq quota or rate limit reached. Check your Groq limits, then retry.'
    elif code in ('model_not_found', 'model_decommissioned'):
        message = 'The configured Groq model is unavailable. Set GROQ_MODEL to a model enabled in your Groq console and restart the app.'
    elif code == 'json_validate_failed':
        message = 'Groq could not produce a valid action plan. Retry with a shorter, more specific request.'
    elif response.status_code == 413 or code == 'context_length_exceeded':
        message = 'This conversation is too large for the Groq model. Start a new chat and select one workspace.'
    elif response.status_code == 403:
        message = 'Groq denied access. Check model permissions and account access in your Groq console.'
    elif response.status_code >= 500:
        message = 'Groq is temporarily unavailable. Retry in a moment.'
    else:
        message = f'Groq rejected this request (HTTP {response.status_code}). Check the model and account settings in your Groq console.'
    raise ValueError(message)


def response_text(response):
    check_response(response)
    try:
        choice = response.json()['choices'][0]
        if choice.get('finish_reason') == 'length':
            raise ValueError('The AI response was cut short. Retry with a smaller request.')
        content = choice['message']['content']
        if not isinstance(content, str) or not content.strip():
            raise KeyError('content')
        return content.strip()
    except (KeyError, IndexError, TypeError, AttributeError, json.JSONDecodeError):
        raise ValueError('Groq returned an empty or invalid response. Retry this request.') from None


async def complete(client, key, payload):
    """Recover from retired models using Groq's authenticated model catalogue."""
    started=time.monotonic()
    cache_key=(hashlib.sha256(key.encode()).hexdigest(),payload['model'])
    cached=_model_cache.get(cache_key)
    if cached and cached[1]>started:
        payload={**payload,'model':cached[0]}
    headers = {'Authorization': 'Bearer ' + key}
    url = 'https://api.groq.com/openai/v1/chat/completions'
    payload = dict(payload)
    response = await client.post(url, headers=headers, json=payload)
    unavailable = ('model_not_found', 'model_decommissioned')
    if error_code(response) in unavailable:
        _model_cache.pop(cache_key,None)
        listing = await client.get('https://api.groq.com/openai/v1/models', headers=headers)
        check_response(listing)
        try:
            available = {m['id'] for m in listing.json()['data'] if m.get('active', True)}
        except (ValueError, KeyError, TypeError):
            raise ValueError('Could not read the available Groq models. Retry this request.') from None
        # Only text models suitable for JSON plans; never select speech, guard,
        # or compound tool-using models merely because they appear in the list.
        preferred = ('llama-3.3-70b-versatile', 'openai/gpt-oss-120b',
                     'openai/gpt-oss-20b', 'llama-3.1-8b-instant')
        candidates = [m for m in preferred if m in available and m != payload['model']]
        if not candidates:
            raise ValueError('No supported chat model is available to this Groq key. Enable a text model in the Groq console or set GROQ_MODEL to an enabled JSON-capable model.')
        for model in candidates:
            payload = {**payload, 'model': model}
            response = await client.post(url, headers=headers, json=payload)
            if error_code(response) not in unavailable:
                break
    if error_code(response) == 'json_validate_failed':
        response = await client.post(url, headers=headers, json={**payload, 'temperature': 0})
    if response.status_code==200:
        if len(_model_cache)>=128: _model_cache.clear()
        _model_cache[cache_key]=(payload['model'],time.monotonic()+300)
        usage=response.json().get('usage',{})
        _logger.info('groq model=%s duration_ms=%d prompt_tokens=%s completion_tokens=%s',payload['model'],int((time.monotonic()-started)*1000),usage.get('prompt_tokens'),usage.get('completion_tokens'))
    return response


from contextlib import asynccontextmanager
import httpx

@asynccontextmanager
async def provider_client(app):
    shared=getattr(app.state,'groq_client',None)
    if shared is not None:
        yield shared
    else:
        async with httpx.AsyncClient(timeout=45) as client:
            yield client
