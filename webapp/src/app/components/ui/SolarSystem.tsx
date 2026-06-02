'use client';

import { useEffect, useRef } from 'react';

const SolarSystem = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    
    const container = containerRef.current;
    
    // Create stars
    const createStars = () => {
      const starCount = 200;
      
      for (let i = 0; i < starCount; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        
        const size = Math.random() * 2 + 1;
        star.style.width = `${size}px`;
        star.style.height = `${size}px`;
        
        star.style.left = `${Math.random() * 100}%`;
        star.style.top = `${Math.random() * 100}%`;
        
        star.style.animationDelay = `${Math.random() * 5}s`;
        
        container.appendChild(star);
      }
    };
    
    // Create Sun
    const createSun = () => {
      const sun = document.createElement('div');
      sun.id = 'sun';
      container.appendChild(sun);
      return sun;
    };
    
    // Create planets
    const createPlanets = (sun: HTMLDivElement) => {
      const solarSystemContainer = document.createElement('div');
      solarSystemContainer.id = 'solar-system-container';
      solarSystemContainer.style.position = 'absolute';
      solarSystemContainer.style.top = '0';
      solarSystemContainer.style.left = '0';
      solarSystemContainer.style.width = '100%';
      solarSystemContainer.style.height = '45vh';
      solarSystemContainer.style.display = 'flex';
      solarSystemContainer.style.justifyContent = 'center';
      solarSystemContainer.style.alignItems = 'center';
      container.appendChild(solarSystemContainer);
      
      const planets = [
        { name: 'mercury', size: 8, color: '#b5b5b5', orbitRadius: 60, speed: 4.1 },
        { name: 'venus', size: 12, color: '#e6e6b8', orbitRadius: 85, speed: 1.6 },
        { name: 'earth', size: 12, color: '#2e8ece', orbitRadius: 110, speed: 1 },
        { name: 'mars', size: 10, color: '#c1440e', orbitRadius: 135, speed: 0.5 },
        { name: 'jupiter', size: 25, color: '#e0ae6f', orbitRadius: 170, speed: 0.08 },
        { name: 'saturn', size: 22, color: '#f7e2a1', orbitRadius: 210, speed: 0.03 },
        { name: 'uranus', size: 18, color: '#a6fff8', orbitRadius: 240, speed: 0.01 },
        { name: 'neptune', size: 17, color: '#3e66f9', orbitRadius: 270, speed: 0.005 }
      ];
      
      planets.forEach(planetData => {
        // Create orbit
        const orbit = document.createElement('div');
        orbit.className = 'orbit';
        orbit.style.width = `${planetData.orbitRadius * 2}px`;
        orbit.style.height = `${planetData.orbitRadius * 2}px`;
        solarSystemContainer.appendChild(orbit);
        
        // Create planet
        const planet = document.createElement('div');
        planet.className = 'planet';
        planet.id = planetData.name;
        planet.style.width = `${planetData.size}px`;
        planet.style.height = `${planetData.size}px`;
        planet.style.backgroundColor = planetData.color;
        planet.style.marginLeft = `-${planetData.size / 2}px`;
        planet.style.marginTop = `-${planetData.size / 2}px`;
        
        // Add animation
        const animationDuration = 20 / planetData.speed;
        const keyframesRule = `
          @keyframes orbit-${planetData.name} {
            0% { transform: translate(-50%, -50%) rotate(0deg) translateX(${planetData.orbitRadius}px) rotate(0deg); }
            100% { transform: translate(-50%, -50%) rotate(360deg) translateX(${planetData.orbitRadius}px) rotate(-360deg); }
          }
        `;
        
        // Add keyframes to document
        const styleElement = document.createElement('style');
        styleElement.innerHTML = keyframesRule;
        document.head.appendChild(styleElement);
        
        planet.style.animation = `orbit-${planetData.name} ${animationDuration}s linear infinite`;
        
        solarSystemContainer.appendChild(planet);
      });
    };
    
    // Adjust solar system for different screen sizes
    const adjustSolarSystem = () => {
      const width = window.innerWidth;
      const scaleFactor = width < 768 ? 0.7 : 1;
      
      const planetElements = document.querySelectorAll('.planet');
      const orbitElements = document.querySelectorAll('.orbit');
      
      planetElements.forEach((element) => {
        const planet = element as HTMLElement;
        const currentSize = parseInt(planet.style.width);
        if (!isNaN(currentSize)) {
          planet.style.width = `${currentSize * scaleFactor}px`;
          planet.style.height = `${currentSize * scaleFactor}px`;
          planet.style.marginLeft = `-${(currentSize * scaleFactor) / 2}px`;
          planet.style.marginTop = `-${(currentSize * scaleFactor) / 2}px`;
        }
      });
      
      orbitElements.forEach((element) => {
        const orbit = element as HTMLElement;
        const widthValue = parseInt(orbit.style.width);
        if (!isNaN(widthValue)) {
          orbit.style.width = `${widthValue * scaleFactor}px`;
          orbit.style.height = `${widthValue * scaleFactor}px`;
        }
      });
    };
    
    // Initialize
    createStars();
    const sun = createSun();
    createPlanets(sun);
    adjustSolarSystem();
    
    // Handle resize
    window.addEventListener('resize', adjustSolarSystem);
    
    // Cleanup
    return () => {
      window.removeEventListener('resize', adjustSolarSystem);
      container.innerHTML = '';
    };
  }, []);
  
  return <div ref={containerRef} className="solar-system" />;
};

export default SolarSystem;