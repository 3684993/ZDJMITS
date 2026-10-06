import WebSocket from 'ws';
export function probe(transport){ return new WebSocket(transport.effectiveWsUrl(), transport.websocketOptions()); }
