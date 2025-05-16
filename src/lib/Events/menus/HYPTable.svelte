<script lang="ts">
  // TODO: Make sensor disappear on destroy
  // TODO: Update browser tab text
  // TODO: Figure out how to update database with real time nominations highlight in red on mount
  // TODO: If time allows, figure out the camera movement to automate
  import { onMount, onDestroy } from "svelte";
  import { activeEvent } from "@/stores/events.store";
  import { activeGroup } from "@/stores/spacecatalog.group.store";
  import {
    Cartesian3,
    ClockRange,
    Color,
    ConstantProperty,
    JulianDate,
    SpaceEntity,
    Entity,
    Cartographic,
    Math as CesiumMath,
    HeadingPitchRoll,
    Matrix3,
    Matrix4,
    Transforms,
    Quaternion,
    SampledPositionProperty,
    VelocityOrientationProperty,
    CallbackProperty,
    PolylineGlowMaterialProperty,
    Event as CesiumEvent,
    EntityCollection
  } from "orbpro";
  import { type Entity } from "orbpro";
  import { HYPT } from "@/classes/standards/HYP/HYP";
  import { scenario } from "@/stores/settings.store";
  import { active } from "d3";
  import { writable, get } from "svelte/store";
  const { trackedEntity } = scenario;

  // Define interface for object of interest
  interface ObjectOfInterest {
    objectID: string;
    commonName: string;
    country: string;
    catalogType: string;
    priority: string;
    highlighted?: boolean;
  }

  let originalEntityProperties = new Map();
  const viewer = (globalThis as any).viewer;
  let scheduledUpdates = [];
  // Explicitly track flashing cells by position
  let flashingCellsArray = [];  // Using an array instead of Map for better reactivity
  let flashingCellsVersion = 0; // Counter to force reactivity
  let isDemoMode = false;
  let originalMatrix = null; 
  let originalPriority = null;
  let priorityFlashing = false; // Flag for priority highlighting
  let sensorEntity: Entity | null = null; // Reference to the sensor entity
  let sensorCone: Entity | null = null; // Reference to the visibility cone
  
   // Objects of Interest store
  const objectsOfInterest = writable<ObjectOfInterest[]>([
    { objectID: "63604", commonName: "SHIYAN 27F", country: "CN", catalogType: "PAYLOAD", priority: "4" },
    { objectID: "55507", commonName: "BLOCK DM-SL R/B", country: "CIS", catalogType: "ROCKET BODY", priority: "3" },
    { objectID: "44637", commonName: "TJS-4", country: "CN", catalogType: "PAYLOAD", priority: "5" },
    { objectID: "55131", commonName: "SJ-23", country: "CN", catalogType: "PAYLOAD", priority: "3" },
    { objectID: "55842", commonName: "BREEZE-M R/B", country: "CIS", catalogType: "ROCKET BODY", priority: "4" },
    { objectID: "55180", commonName: "SJ-23 AKM", country: "CN", catalogType: "ROCKET BODY", priority: "4" },
    { objectID: "50001", commonName: "EXPRESS AMU-7", country: "CIS", catalogType: "PAYLOAD", priority: "3" },
    { objectID: "43432", commonName: "COSMOS 2526", country: "CIS", catalogType: "PAYLOAD", priority: "4" },
  ]);

  function updateObject(objectID: string, updates: Partial<ObjectOfInterest>) {
    objectsOfInterest.update(objects => {
      return objects.map(obj => {
        if (obj.objectID === objectID) {
          return { ...obj, ...updates };
        }
        return obj;
      });
    });
  }

  function sortObjectsByPriority() {
    objectsOfInterest.update(objects => {
      return [...objects].sort((a, b) => {
        // Sort by priority (lower priority number = higher importance)
        return parseInt(a.priority) - parseInt(b.priority) || 
               // Then sort alphabetically by name if priorities are equal
               a.commonName.localeCompare(b.commonName);
      });
    });
  }

  function highlightObject(objectID: string, highlight: boolean = true) {
    updateObject(objectID, { highlighted: highlight });
    
    // Clear highlight after 3 seconds
    if (highlight) {
      setTimeout(() => {
        updateObject(objectID, { highlighted: false });
      }, 3000);
    }
  }
  
  onMount(() => {
  const existingSensor = viewer?.entities.getById('ground-sensor');
  if (existingSensor) {
    viewer.entities.remove(existingSensor);
  }
  
  const existingCone = viewer?.entities.getById('visibility-cone');
  if (existingCone) {
    viewer.entities.remove(existingCone);
  }
  
  // Reset state variables
  flashingCellsArray = [];
  flashingCellsVersion = 0;
  priorityFlashing = false;
    // Check if this is a demo event
    isDemoMode = !!$activeEvent?.DEMO;

    $activeGroup = "defaultGroup";
    const sDC = viewer?.dataSources.getByName("spaceaware")[0];
    setTimeout(() => 
      focusOnEntity($activeEvent?.ID, true), 1000);  // Pass true to enable camera animation

    if ($activeEvent?.ID) {
      const entity = sDC?.entities.getById($activeEvent.ID);
      originalEntityProperties.set(entity, {
          pixelSize: entity.point.pixelSize,
          color: entity.point.color,
          show: entity.show
        });
      
      entity.point.color = Color.RED;
      entity.point.pixelSize = 10;
      if (entity.label) {
        entity.label.show = true;
        entity.label.text = $activeEvent?.NAME;
      }
      (entity as SpaceEntity).showOrbit({show: true})
    }

    // Parse the start and end times
    const eventStartTimeString = ($activeEvent as HYPT)
      .EVENT_START_TIME as string;
    const eventEndTimeString = ($activeEvent as HYPT).EVENT_END_TIME as string;

    const eventStartTimeDate = new Date(eventStartTimeString);
    const eventEndTimeDate = new Date(eventEndTimeString);
    let startTime: JulianDate;
    let endTime: JulianDate;
    if (
      !isNaN(eventStartTimeDate.getTime()) &&
      !isNaN(eventEndTimeDate.getTime())
    ) {

      startTime = JulianDate.fromDate(eventStartTimeDate);
      endTime = JulianDate.fromDate(eventEndTimeDate);
      setTimeout(() => {
      viewer.clock.currentTime = startTime;
    }, 1000);
    
      
      // Only set up scheduled updates if in demo mode
      if (isDemoMode) {
        originalMatrix = [...$activeEvent?.MATRIX];
        originalPriority = $activeEvent?.PRIORITY;
        sortObjectsByPriority(); // Sort the objects list initially
        displaySensor(eventStartTimeDate);
        scheduleMatrixUpdates(eventStartTimeDate);
      }
    } else {
      startTime = viewer.clock.currentTime;
      // Handle invalid dates here
      console.error("Invalid date format");
    }
    
    
    // Only set up clock listener if in demo mode
    let clockTickListener = null;
    if (isDemoMode) {
      viewer.clock.currentTime = startTime;
      // Watch for clock changes to trigger updates based on time
      clockTickListener = viewer.clock.onTick.addEventListener((clock) => {
        const currentTime = JulianDate.toDate(clock.currentTime);
        checkScheduledUpdates(currentTime);
      });
      
      // Store the listener to remove it later
      originalEntityProperties.set('clockListener', clockTickListener);
    }
  });

  function displaySensor(startTime) {
    // Schedule sensor activation 10 seconds after event start

    const sensorActivationTime = new Date(startTime.getTime() + 130000);

    // Schedule sensor deactivation 2 minutes after activation
    const sensorDeactivationTime = new Date(startTime.getTime() + 200000);

    const sDC = viewer?.dataSources.getByName("spaceaware")[0];

    scheduledUpdates.push({
      time: startTime,
      update: () => {
        const { latitude, longitude, altitude } = $activeEvent.SENSOR_LOCATION;
        setTimeout(() => {
          let sensor = createSensor(latitude, longitude, altitude || 0);
          const entity = sDC?.entities.getById($activeEvent.ID);
          
          // Add notification or visual indicator that sensor is active
          if (sensor.label) {
            sensor.label.text = new ConstantProperty('Sensor');
            sensor.point.color = new ConstantProperty(Color.GRAY);
          }
        });
      },
      executed: false
    });
   

    // Schedule sensor activation
    scheduledUpdates.push({
      time: sensorActivationTime,
      update: () => {
        const { latitude, longitude, altitude } = $activeEvent.SENSOR_LOCATION;
        setTimeout(() => {
          let sensor = viewer.entities.getById('ground-sensor')
          const entity = sDC?.entities.getById($activeEvent.ID);
          
          // Create cone-shaped visibility indicator
          if (sensor && entity) {
           
            createVisibilityCone(sensor, entity);
            
            // Add notification or visual indicator that sensor is active
            if (sensor.label) {
              sensor.label.text = new ConstantProperty('Sensor');
              sensor.point.color = new ConstantProperty(Color.LIME);
            }
          }
        });
      },
      executed: false
    });
    
    // Schedule sensor deactivation
    scheduledUpdates.push({
      time: sensorDeactivationTime,
      update: () => {
        if (sensorEntity) {
          // Change sensor appearance to indicate it's inactive
          sensorEntity.point.color = new ConstantProperty(Color.GRAY);
          if (sensorEntity.label) {
            sensorEntity.label.text = new ConstantProperty('Sensor');
          }
          
          // Remove the visibility cone
          if (sensorCone) {
           
            viewer.entities.remove(sensorCone);
            sensorCone = null;
          
          }
        }
      },
      executed: false
    });
  }

  // Function to schedule matrix updates
  function scheduleMatrixUpdates(startTime) {
    // Schedule update 120 seconds after event start
    const update1Time = new Date(startTime.getTime() + 220000);
    scheduledUpdates.push({
      time: update1Time,
      update: () => {
        // Update VMAG and AMR from null to true
        if ($activeEvent?.MATRIX) {
          // Create a deep copy of the activeEvent
          const updatedEvent = {...$activeEvent};
          const matrixCopy = [...updatedEvent.MATRIX];
          
          // VMAG is index 1, TC is index 3 in the first row
          matrixCopy[1] = true; // Update VMAG
          matrixCopy[3] = true; // Update TC
          
          // Update the matrix in the copy
          updatedEvent.MATRIX = matrixCopy;
          
          // Clear any existing flashing cells first
          flashingCellsArray = [];
          flashingCellsVersion++;
          
          // Mark these cells for flashing
          flashCell(0, 1); // Row 0, Col 1 (VMAG)
          flashCell(0, 3); // Row 0, Col 3 (TC)
          
          // Update the activeEvent store with the new object to trigger Svelte reactivity
          $activeEvent = updatedEvent;
        }
      },
      executed: false
    });
    
    // Schedule priority update
    const priorityUpdateTime = new Date(startTime.getTime() + 240000);
    scheduledUpdates.push({
      time: priorityUpdateTime, 
      update: () => {
        // Get latest version from the store
        const currentEvent = $activeEvent;
        
        // Create updated event with new priority
        const updatedEvent = {
          ...currentEvent,
          PRIORITY: "2" // Change priority from 4 to 2
        };
        const newMatrix = [...$activeEvent?.MATRIX];
        newMatrix[3] = 1;
        updatedEvent.MATRIX = newMatrix;
        
        // Update the object in the list and sort the list
        updateObject($activeEvent.ID, { priority: "2" });
        sortObjectsByPriority();
        highlightObject($activeEvent.ID);
        
        // Start priority flashing
        priorityFlashing = true;
        setTimeout(() => {
          priorityFlashing = false;
        }, 3000); // Flash for 3 seconds
        
        // Update the store directly
        $activeEvent = updatedEvent;
      },
      executed: false
    });
  }
  
  function checkScheduledUpdates(currentTime) {
    let updatesExecuted = false;
    
    scheduledUpdates.forEach(update => {
      if (!update.executed && currentTime >= update.time) {
        update.update();
        update.executed = true;
        updatesExecuted = true;
      }
    });
    
  }
  
  // Function to make a cell flash
  function flashCell(rowIndex, colIndex) {
    const cellKey = `${rowIndex}-${colIndex}`;
    
    // Add to flashing cells array
    flashingCellsArray.push(cellKey);
    flashingCellsVersion++; // Increment to force reactivity
    
    // Stop flashing after 2 seconds
    setTimeout(() => {
      
      // Remove from array
      const index = flashingCellsArray.indexOf(cellKey);
      if (index > -1) {
        flashingCellsArray.splice(index, 1);
        flashingCellsVersion++; // Increment again to force reactivity
      }
    }, 2000);
  }

  onDestroy(() => {
    $activeGroup = "defaultGroup";
    
    const sDC = (globalThis as any).viewer?.dataSources.getByName(
      "spaceaware"
    )[0];

    // Remove clock listener
    const clockListener = originalEntityProperties.get('clockListener');
    if (clockListener) {
      viewer.clock.onTick.removeEventListener(clockListener);
    }
    // Remove sensor 
    if (sensorEntity) {
      viewer.entities.remove(sensorEntity);
      sensorEntity = null;
    }

    if (sensorCone) {
      viewer.entities.remove(sensorCone);
      sensorCone = null;
    }
    
    // Clear scheduled updates
    scheduledUpdates = [];
    
    // Clear all flashing cells
    flashingCellsArray = [];
    flashingCellsVersion++;

    // Reset event matrix
    if (isDemoMode) {
      $activeEvent.MATRIX = originalMatrix;
      $activeEvent.PRIORITY = originalPriority;
    }
    
    // Restore previous point configuration onDestroy and show all entities
    originalEntityProperties.forEach((props, e) => {
      if (typeof e === 'string') return; // Skip string keys like 'clockListener'
      
      if (e.point) {
        e.point.pixelSize = props.pixelSize;
        e.point.color = props.color;
        (e as SpaceEntity).showOrbit({ show: false });
        e.show = true;
      }
    }
    
  );

    // Restore label settings onDestroy
    sDC?.entities.values.forEach((e: Entity) => {
      e.show = true;
      if (e.label) {
        e.label.show = new ConstantProperty(false); // Hide labels onDestroy
      }
    });

    (globalThis as any).viewer!.scene.render;
    $activeEvent = new HYPT();
    originalEntityProperties = new Map();
  });

  $: extraRows =
    Math.ceil(
      ($activeEvent?.MATRIX?.length || 0) /
        ($activeEvent?.COL_INDICATORS?.length || 1)
    ) - ($activeEvent?.ROW_INDICATORS?.length || 0);

  function getCellClass(rowIndex: any, colIndex: any) {
    const matrixIndex =
      rowIndex * ($activeEvent?.COL_INDICATORS?.length || 0) + colIndex;
    
    // Cell flashing logic
    const cellKey = `${rowIndex}-${colIndex}`;
    if (flashingCellsArray.includes(cellKey)) {
      return "bg-red-600 animate-pulse";
    }
    
    if ($activeEvent?.MATRIX[matrixIndex] === null) {
      return "";
    }
    if (matrixIndex < ($activeEvent?.MATRIX?.length || 0)) {
      return $activeEvent?.MATRIX[matrixIndex] ? "bg-red-600" : "bg-green-600";
    }
    return "";
    
  }

  function getCellValue(rowIndex: any, colIndex: any) {
    const matrixIndex =
      rowIndex * ($activeEvent?.COL_INDICATORS?.length || 0) + colIndex;
    if ($activeEvent?.MATRIX[matrixIndex] === null) {
      return "";
    }
    if (matrixIndex < ($activeEvent?.MATRIX?.length || 0)) {
      return $activeEvent?.MATRIX[matrixIndex] ? "Alert" : "Normal";
    }
    return "";
  }

  // Function to set the clock to a specific time
  function setClockToTime(timeString: string) {
    const time = JulianDate.fromDate(new Date(timeString));
    (globalThis as any).viewer!.clock.currentTime = time;
  }

  // Function to focus the camera on an entity with a better initial view
  function focusOnEntity(entityId: string, withBetterView: boolean = true) {
    const entity = (globalThis as any).viewer?.dataSources
      .getByName("spaceaware")[0]
      ?.entities.getById(entityId.toString()) as Entity;
    
    if (!entity) {
      console.error(`Entity with ID ${entityId} not found`);
      return;
    }
    
    // Set clock settings
    scenario.settings.ClockSettings.shouldAnimate.set(true);
    scenario.settings.ClockSettings.multiplier.set(10);
    
    // Set tracked entity
    $trackedEntity = entity;
  }
  

  // Function to handle cell click
  function onCellClick(rowIndex: number) {
    // Retrieve the entity ID from the ROW_INDICATORS array based on the row index
    const entityId = $activeEvent?.ROW_INDICATORS[rowIndex];
    if (entityId) {
      focusOnEntity(entityId, false); // Don't animate when clicking cells
    }
  }

  // Function to handle objectID click
  function onObjectClick(objectID: string) {
    focusOnEntity(objectID, false); // Don't animate when clicking table rows
  }
  
  // Function to manually trigger updates (for testing)
  function triggerNextUpdate() {
    const pendingUpdate = scheduledUpdates.find(update => !update.executed);
    if (pendingUpdate) {
      console.log("Manually triggering update");
      pendingUpdate.update();
      pendingUpdate.executed = true;
    } else {
      console.log("No pending updates to trigger");
    }
  }

  function createSensor(latitude: number, longitude: number, altitude: number = 0): Entity | null {
    if (!viewer) {
      console.error("Viewer not initialized");
      return null;
    }
    
    // Convert lat/lon to Cartesian3
    const position = Cartesian3.fromDegrees(longitude, latitude, altitude);
    
    // Create the sensor entity
    sensorEntity = new Entity({
      id: 'ground-sensor',
      name: 'Ground Sensor',
      position: position,
      point: {
        pixelSize: 12,
        color: Color.YELLOW,
        outlineColor: Color.BLACK,
        outlineWidth: 2
      },
      label: {
        text: 'Ground Sensor',
        font: '14pt sans-serif',
        style: 2, // FILL_AND_OUTLINE
        outlineWidth: 2,
        outlineColor: Color.BLACK,
        verticalOrigin: 1, // BOTTOM
        pixelOffset: new Cartesian3(0, -10, 0),
        show: true
      }
    });
    
    // Add the sensor to the viewer
    viewer.entities.add(sensorEntity);
    
    return sensorEntity;
  }
  
  // Function to create a visibility cone from the sensor to the satellite
  function createVisibilityCone(sensorEntity, satelliteEntity) {
    if (!viewer || !sensorEntity || !satelliteEntity) {
      console.error("Cannot create visibility cone: missing entities or viewer");
      return null;
    }
    
    // Create a dynamic cone using a callback property
    sensorCone = viewer.entities.add({
      id: 'visibility-cone',
      name: 'Sensor Visibility Cone',
      
      // Use custom polyline collection for cone visualization
      polylineVolume: {
        positions: new CallbackProperty(() => {
          // Get current positions of both entities
          const satellitePosition = satelliteEntity.position.getValue(viewer.clock.currentTime);
          const sensorPosition = sensorEntity.position.getValue(viewer.clock.currentTime);
          
          if (!satellitePosition || !sensorPosition) return null;
          
          // Return the path from sensor to satellite
          return [sensorPosition, satellitePosition];
        }, false),
        
        // Create a cone shape that gets wider as it extends to the satellite
        shape: new CallbackProperty(() => {
          // Get current positions to calculate distance
          const satellitePosition = satelliteEntity.position.getValue(viewer.clock.currentTime);
          const sensorPosition = sensorEntity.position.getValue(viewer.clock.currentTime);
          
          if (!satellitePosition || !sensorPosition) {
            return [new Cartesian3(0, 0, 0)];
          }
          
          // Calculate the distance to scale the cone appropriately
          const distance = Cartesian3.distance(sensorPosition, satellitePosition);
          const baseRadius = distance * 0.05; // Cone base radius as 5% of distance
          
          // Create a circle with 16 points for the cone cross-section
          const shape = [];
          for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2;
            const x = Math.cos(angle) * baseRadius;
            const y = Math.sin(angle) * baseRadius;
            shape.push(new Cartesian3(x, y, 0));
          }
          
          return shape;
        }, false),
        
        // Styling for the cone
        material: Color.YELLOW.withAlpha(0.4),
        cornerType: 0 
      }
    });

    return sensorCone;
  }
</script>

<style>
  @keyframes highlight-fade {
    0% { background-color: rgba(255, 165, 0, 0.8); }
    70% { background-color: rgba(255, 165, 0, 0.5); }
    100% { background-color: transparent; }
  }
  
  .priority-highlight {
    animation: highlight-fade 3s ease-out;
    border-radius: 2px;
    padding: 0 4px;
  }
  
  @keyframes row-highlight {
    0% { background-color: rgba(255, 215, 0, 0.6); }
    100% { background-color: transparent; }
  }
  
  .row-highlight {
    animation: row-highlight 3s ease-out;
  }
  
  .objects-list-container {
    max-height: 250px;
    overflow-y: auto;
  }
  
  .objects-list-header {
    position: sticky;
    top: 0;
    background-color: #1f2937;
    z-index: 10;
  }
</style>

<div class="p-1 flex flex-col items-start justify-center min-w-[500px]">
  <div
    class="text-left flex flex-col items-start justify-between mb-4 w-full font-mono">
    <div>
      <div>NAME: {$activeEvent?.NAME}</div>
    </div>
    <div>
      <div 
        class="cursor-pointer"
        on:click={() => {
          focusOnEntity($activeEvent?.ID);
        }}>
      ID: {$activeEvent?.ID}
     </div>
    </div>
    {#key JSON.stringify($activeEvent?.PRIORITY)}
      <div class={priorityFlashing ? "priority-highlight" : ""}>
        PRIORITY: {$activeEvent?.PRIORITY} {priorityFlashing ? '(Updated)' : ''}
      </div>
    {/key}
    <div>
      <div>COUNTRY: {$activeEvent?.COUNTRY_CODE}</div>
    </div>
    <div class="cursor-pointer">
      <div on:click={() => setClockToTime($activeEvent?.EVENT_START_TIME)}>
        EVENT_TIME: {$activeEvent?.EVENT_START_TIME}
      </div>
    </div>
  </div>
  
  <div class="overflow-auto p-2 w-full max-h-[300px]">
    {#if $activeEvent?.COL_INDICATORS?.length}
      <!-- Use a key block to force rerender when flashingCells changes -->
      {#key [$activeEvent?.MATRIX, flashingCellsVersion]}
        <table class="w-full border-collapse">
          <tr>
            <th></th>

            {#each $activeEvent?.COL_INDICATORS as colIndicator}
              <th class="border px-2 whitespace-nowrap w-6 h-6"
                >{colIndicator}</th>
            {/each}
          </tr>
          {#if $activeEvent?.ROW_INDICATORS}
            {#each $activeEvent?.ROW_INDICATORS as rowIndicator, rowIndex}
              <tr>
                <th class="border px-2 w-6 h-6">{rowIndicator}</th>
                {#each $activeEvent?.COL_INDICATORS as _, colIndex}
                  <td
                    class="border text-center font-bold w-6 h-6 {getCellClass(rowIndex, colIndex)}"
                    on:click={() => onCellClick(rowIndex)}
                    >{getCellValue(rowIndex, colIndex)}</td>
                {/each}
              </tr>
            {/each}
          {/if}
          {#if extraRows > 0}
            <tr>
              <th class="border px-2"></th>
              {#each Array($activeEvent?.COL_INDICATORS?.length || 0) as _, colIndex}
                <td
                  class="border text-center font-bold w-6 h-6 {getCellClass(
                    $activeEvent?.ROW_INDICATORS?.length,
                    colIndex
                  )}">{getCellValue($activeEvent?.ROW_INDICATORS?.length, colIndex)}</td>
              {/each}
            </tr>
          {/if}
        </table>
      {/key}
    {:else}
      No COL_INDICATORS <br />
      {#if !$activeEvent?.ROW_INDICATORS?.length}
        No ROW_INDICATORS
      {/if}
    {/if}
  </div>
  
  <!-- Objects of Interest List -->
  <div class="mt-4 w-full">
    <h3 class="font-bold text-sm mb-2 border-b pb-1">Objects of Interest</h3>
    <div class="objects-list-container">
      <table class="w-full text-xs">
        <thead class="objects-list-header">
          <tr class="bg-gray-800">
            <th class="text-left px-2 py-1 font-bold">Object ID</th>
            <th class="text-left px-2 py-1 font-bold">Common Name</th>
            <th class="text-left px-2 py-1 font-bold">Country</th>
            <th class="text-left px-2 py-1 font-bold">Type</th>
            <th class="text-center px-2 py-1 font-bold">Priority</th>
          </tr>
        </thead>
        <tbody>
          {#each $objectsOfInterest as object (object.objectID)}
            <tr 
              class={`${object.highlighted ? 'row-highlight' : ''} ${object.objectID === $activeEvent?.ID ? 'bg-blue-900 bg-opacity-50' : 'hover:bg-gray-700'} cursor-pointer`}
              on:click={() => onObjectClick(object.objectID)}
            >
              <td class="px-2 py-1 border-b border-gray-700">{object.objectID}</td>
              <td class="px-2 py-1 border-b border-gray-700">{object.commonName}</td>
              <td class="px-2 py-1 border-b border-gray-700">{object.country}</td>
              <td class="px-2 py-1 border-b border-gray-700">{object.catalogType}</td>
              <td class={`px-2 py-1 text-center border-b border-gray-700 ${object.priority === '1' ? 'bg-red-900' : object.priority === '2' ? 'bg-orange-800' : object.priority === '3' ? 'bg-yellow-800' : 'bg-green-800'}`}>
                {object.priority}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>