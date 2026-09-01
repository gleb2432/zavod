import { useEffect, useState, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, GeoJSON, Polyline, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import PathFinder from 'geojson-path-finder';
import * as turf from '@turf/turf';

const START_COORDS = [73.2011636, 54.9961476]; 

const startSquareIcon = L.divIcon({
  className: 'custom-square',
  html: '<div style="width: 18px; height: 18px; background-color: #2563eb; border: 3px solid #ffffff; border-radius: 4px; box-shadow: 0 4px 6px rgba(0,0,0,0.3);"></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

export default function App() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [routes, setRoutes] = useState<any>(null);
  const [places, setPlaces] = useState<any>(null);
  const [gates, setGates] = useState<any>(null);
  const [pathFinder, setPathFinder] = useState<any>(null);
  
  const [activeRoute, setActiveRoute] = useState<any>(null);
  const [routeInfo, setRouteInfo] = useState<{ distance: number, time: number, name: string } | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredGates, setFilteredGates] = useState<any[]>([]);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const [mapType, setMapType] = useState<'satellite' | 'schema'>('satellite');

  const [isNavigating, setIsNavigating] = useState(false);
  const watchIdRef = useRef<number | null>(null);
  const userLocationRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    fetch('/routes.geojson')
      .then(res => res.json())
      .then(data => {
        const flatData = turf.flatten(data);
        // Фильтруем геометрии, оставляя только линии для PathFinder
        const lineFeatures = flatData.features.filter(
          (f: any) => f.geometry && (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString')
        );
        const validFeatureCollection = turf.featureCollection(lineFeatures);
        
        setRoutes(validFeatureCollection);
        setPathFinder(new PathFinder(validFeatureCollection, { precision: 1e-3 }));
      });

    fetch('/places.geojson').then(res => res.json()).then(setPlaces);
    fetch('/gates.geojson').then(res => res.json()).then(setGates);
  }, []);

  useEffect(() => {
    if (!searchQuery.trim() || !gates) {
      setFilteredGates([]);
      return;
    }
    const lowerQuery = searchQuery.toLowerCase();
    const results = gates.features.filter((f: any) => 
      f.properties?.name?.toLowerCase().includes(lowerQuery) || 
      f.properties?.phone?.toLowerCase().includes(lowerQuery)
    );
    setFilteredGates(results);
  }, [searchQuery, gates]);

  const calculateRoute = (lat: number, lng: number, targetName: string) => {
    if (!pathFinder || !routes) return;
    
    const allRoadVertices = turf.explode(routes);
    const currentStartCoords = userLocationRef.current 
      ? [userLocationRef.current[1], userLocationRef.current[0]] 
      : START_COORDS;

    const startPointRaw = turf.point(currentStartCoords);
    const snappedStart = turf.nearestPoint(startPointRaw, allRoadVertices);
    
    const finishPointRaw = turf.point([lng, lat]);
    const snappedFinish = turf.nearestPoint(finishPointRaw, allRoadVertices);

    try {
      const path = pathFinder.findPath(snappedStart, snappedFinish);
      if (path && path.path) {
        const leafletCoords = path.path.map((coord: number[]) => [coord[1], coord[0]]);
        leafletCoords.unshift([currentStartCoords[1], currentStartCoords[0]]);
        leafletCoords.push([lat, lng]);
        
        setActiveRoute(leafletCoords);

        const lineString = turf.lineString(path.path);
        const distanceKm = turf.length(lineString, { units: 'kilometers' });
        const distanceMeters = Math.round(distanceKm * 1000);
        const timeMinutes = Math.ceil(distanceMeters / 166);

        setRouteInfo({
          distance: distanceMeters,
          time: timeMinutes === 0 ? 1 : timeMinutes,
          name: targetName
        });
      } else {
        alert("Маршрут не найден! Проверьте соединения дорог.");
      }
    } catch (err) {
      console.error("Ошибка маршрутизации:", err);
    }
  };

  const onEachGate = (feature: any, layer: any) => {
    const { name, phone, hours } = feature.properties;
    if (name) {
      layer.bindPopup(`
        <div style="font-family: sans-serif; min-width: 150px;">
          <b style="font-size: 14px; display: block; margin-bottom: 5px;">${name}</b>
          <div style="margin-bottom: 3px;">📞 ${phone || 'Нет телефона'}</div>
          <div>🕒 ${hours || 'Нет графика'}</div>
        </div>
      `);
    }
    layer.on('click', (e: any) => {
      calculateRoute(e.latlng.lat, e.latlng.lng, name || 'Ворота');
    });
  };

  const locateUser = () => {
    if (!navigator.geolocation) return alert("Геолокация не поддерживается");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation([latitude, longitude]);
        userLocationRef.current = [latitude, longitude];
        if (map) map.flyTo([latitude, longitude], 18, { animate: true, duration: 1.5 });
      },
      () => alert("Разрешите доступ к геопозиции в браузере"),
      { enableHighAccuracy: true }
    );
  };

  const startNavigation = () => {
    if (!navigator.geolocation) return alert("Геолокация не поддерживается");
    setIsNavigating(true);
    if (map) map.setZoom(19);

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation([latitude, longitude]);
        userLocationRef.current = [latitude, longitude];
        if (map) map.panTo([latitude, longitude], { animate: true });
      },
      (error) => console.warn(error),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    watchIdRef.current = id;
  };

  const stopNavigation = () => {
    setIsNavigating(false);
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setActiveRoute(null);
    setRouteInfo(null);
  };

  return (
    <div style={{ position: 'relative', height: '100vh', width: '100vw', overflow: 'hidden', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {!isNavigating && (
        <div style={{ position: 'absolute', top: 15, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%', maxWidth: '400px' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)',
            borderRadius: '12px', padding: '10px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)',
            display: 'flex', alignItems: 'center'
          }}>
            <span style={{ fontSize: '20px', marginRight: '10px' }}>🔍</span>
            <input 
              type="text" 
              placeholder="Поиск склада или ворот..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{ width: '100%', border: 'none', outline: 'none', fontSize: '16px', background: 'transparent' }}
            />
          </div>

          {filteredGates.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, background: 'rgba(255, 255, 255, 0.95)', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
              {filteredGates.map((f, i) => (
                <li 
                  key={i} 
                  style={{ padding: '15px', borderBottom: i !== filteredGates.length - 1 ? '1px solid #eee' : 'none', cursor: 'pointer' }}
                  onClick={() => {
                    const [lng, lat] = f.geometry.coordinates;
                    if (map) map.flyTo([lat, lng], 18);
                    calculateRoute(lat, lng, f.properties.name);
                    setSearchQuery('');
                  }}
                >
                  <b style={{ color: '#1f2937' }}>{f.properties.name}</b>
                  {f.properties.hours && <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>🕒 {f.properties.hours}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!isNavigating && (
        <button 
          onClick={() => setMapType(prev => prev === 'satellite' ? 'schema' : 'satellite')}
          style={{
            position: 'absolute', right: 15, top: 70, zIndex: 1000,
            background: 'white', border: 'none', borderRadius: '12px', padding: '10px 14px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.2)', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold', color: '#1f2937',
            display: 'flex', alignItems: 'center', gap: '6px'
          }}
        >
          {mapType === 'satellite' ? '🗺️ Схема' : '🛰️ Спутник'}
        </button>
      )}

      {!isNavigating && (
        <button 
          onClick={locateUser}
          style={{
            position: 'absolute', right: 15, top: '50%', transform: 'translateY(-50%)', zIndex: 1000,
            background: 'white', border: 'none', borderRadius: '50%', width: '48px', height: '48px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.2)', cursor: 'pointer', fontSize: '20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          📍
        </button>
      )}

      {!isNavigating && (
        <button 
          onClick={() => setShowInfo(true)}
          style={{
            position: 'absolute', right: 15, top: 15, zIndex: 1000,
            background: 'white', border: 'none', borderRadius: '50%', width: '40px', height: '40px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.2)', cursor: 'pointer', fontSize: '18px', fontWeight: 'bold', color: '#2563eb'
          }}
        >
          i
        </button>
      )}

      {showInfo && (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', padding: '25px', borderRadius: '16px', width: '80%', maxWidth: '300px', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#1f2937' }}>Внутренняя навигация</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '14px', color: '#4b5563' }}>
              Разработано для оптимизации логистических процессов Омского филиала «Напитки вместе».
            </p>
            <div style={{ fontSize: '13px', color: '#9ca3af', marginBottom: '20px' }}>
              Разработчик:<br/>
              <b>Цыганков Глеб Алексеевич</b>
            </div>
            <button onClick={() => setShowInfo(false)} style={{ background: '#2563eb', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '8px', width: '100%', fontWeight: 'bold' }}>
              Закрыть
            </button>
          </div>
        </div>
      )}

      {routeInfo && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 1000,
          background: 'white', padding: '20px', borderRadius: '16px', width: '90%', maxWidth: '400px',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: '15px',
          animation: 'slideUp 0.3s ease-out'
        }}>
          <style>{`@keyframes slideUp { from { transform: translate(-50%, 100%); } to { transform: translate(-50%, 0); } }`}</style>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: 'bold', textTransform: 'uppercase' }}>
                {isNavigating ? 'Вы в пути' : 'Маршрут построен'}
              </div>
              <div style={{ fontSize: '18px', color: '#1f2937', fontWeight: 'bold', marginTop: '2px' }}>{routeInfo.name}</div>
            </div>
            {!isNavigating && (
              <button onClick={() => { setActiveRoute(null); setRouteInfo(null); }} style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: '30px', height: '30px', fontSize: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            )}
          </div>
          
          <div style={{ display: 'flex', gap: '15px', padding: '15px', background: '#f8fafc', borderRadius: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>В пути</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>~{routeInfo.time} мин</div>
            </div>
            <div style={{ width: '1px', background: '#e2e8f0' }}></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', color: '#64748b' }}>Расстояние</div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#3b82f6' }}>{routeInfo.distance} м</div>
            </div>
          </div>

          {!isNavigating ? (
            <button onClick={startNavigation} style={{ background: '#10b981', color: 'white', border: 'none', padding: '15px', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 4px 6px rgba(16, 185, 129, 0.3)' }}>
              Поехали! 🚗
            </button>
          ) : (
            <button onClick={stopNavigation} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '15px', borderRadius: '12px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer', width: '100%', boxShadow: '0 4px 6px rgba(239, 68, 68, 0.3)' }}>
              Завершить маршрут
            </button>
          )}
        </div>
      )}

      <MapContainer center={[54.9961476, 73.2011636]} zoom={17} style={{ height: '100%', width: '100%', zIndex: 1 }} crs={L.CRS.EPSG3395} ref={setMap} zoomControl={false}>
        
        {mapType === 'satellite' ? (
          <TileLayer url="https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}" maxNativeZoom={18} maxZoom={22} />
        ) : (
          <TileLayer url="https://core-renderer-tiles.maps.yandex.net/tiles?l=map&x={x}&y={y}&z={z}" maxNativeZoom={18} maxZoom={22} />
        )}
        
        <Marker position={[54.9961476, 73.2011636]} icon={startSquareIcon} />

        {userLocation && (
          <CircleMarker center={userLocation} radius={isNavigating ? 10 : 8} fillColor="#3b82f6" color="#ffffff" weight={3} fillOpacity={1}>
            <Popup>Вы здесь</Popup>
          </CircleMarker>
        )}

        {routes && <GeoJSON data={routes} style={{ color: '#3b82f6', weight: 5, opacity: 0.8 }} />}
        {places && <GeoJSON data={places} style={{ color: '#ef4444', weight: 2, fillOpacity: 0.2, interactive: false }} />}
        {gates && <GeoJSON data={gates} pointToLayer={(_f, latlng) => L.circleMarker(latlng, { radius: 10, fillColor: "#f97316", color: "#ffffff", weight: 3, fillOpacity: 1 })} onEachFeature={(f, l) => onEachGate(f, l)} />}

        {activeRoute && <Polyline positions={activeRoute} color="#10b981" weight={8} lineCap="round" lineJoin="round" opacity={0.8} />}
      </MapContainer>
    </div>
  );
}