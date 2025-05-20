<!-- ObjectsOfInterest/Modal.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { content, lastcontent } from "@/stores/modal.store";
  import { scenario } from "@/stores/settings.store";
  import CloseButton from "@/lib/elements/CloseButton.svelte";
  import { 
    objectsOfInterestData, 
    fetchObjectsOfInterest,
    sortObjectsByPriority,
    highlightObject,
    isLoading,
    lastUpdated, 
    sampleData
  } from "@/stores/ooi.store";
  import {
    datatableShow,
    data,
    columnDefs,
    gridApi
  } from "@/stores/ooi_datatable.store";
  
  // Import AG Grid
  import { Grid } from 'ag-grid-community';
  import { Color, JulianDate } from "orbpro";
  import { viewer } from "@/stores/viewer.store";
 
  // State for detailed view
  let selectedObject = null;
  let showDetailPanel = false;
  let detailMatrixData = null;
  
  const { trackedEntity } = scenario;
  let _shouldAnimate = true;
  let gridDiv;
  let originalEntityProperties = new Map(); // To store original entity properties
  
  // Define the column structure for the AG Grid
  const objectsOfInterestColumns = [
    { field: 'eventStartTime', headerName: 'Time of Nomination', sortable: true, filter: true, flex: 2},
    { field: 'objectID', headerName: 'NORAD CAT ID', sortable: true, filter: true, flex: 2 },
    { field: 'commonName', headerName: 'Common Name', sortable: true, filter: true, flex: 2 },
    { field: 'country', headerName: 'Country', sortable: true, filter: true, flex: 2 },
    { field: 'catalogType', headerName: 'Type', sortable: true, filter: true, flex: 2 },
    { 
      field: 'priority', 
      headerName: 'Priority', 
      sortable: true, 
      filter: true,
      flex: 2,
      cellStyle: params => {
        const priority = params.value;
        let bgColor = '';
        
        switch(priority) {
          case '1': bgColor = 'rgb(153, 27, 27)'; break; // red-900
          case '2': bgColor = 'rgb(180, 83, 9)';  break; // orange-800
          case '3': bgColor = 'rgb(161, 98, 7)';  break; // yellow-800
          case '4': bgColor = 'rgb(22, 101, 52)'; break; // green-800
          case '5': bgColor = 'rgb(30, 58, 138)'; break; // blue-900
          default:  bgColor = 'rgb(55, 65, 81)';  break; // gray-700
        }
        
        return { backgroundColor: bgColor, color: 'white', textAlign: 'center' };
      }
    }
  ];
  
  // Function to generate matrix data for the selected object
  function generateMatrixData(objectData) {
    // Create a simple matrix structure similar to the event details component
    return {
      rowIndicators: objectData.row_indicators,
      colIndicators: objectData.col_indicators,
      matrix: objectData.matrix
    };
  }
  
  // Function to show the detail panel for an object
  function showObjectDetails(objectData) {
    const sDC = (globalThis as any).viewer?.dataSources.getByName("spaceaware")[0];
    const entity = sDC?.entities.getById(objectData.objectID);
    entity.point.color = Color.GREEN;
    if (selectedObject) {
      const old_entity = sDC?.entities.getById(selectedObject.objectID)
      old_entity.point.color = Color.RED
    }
    selectedObject = objectData;
    detailMatrixData = generateMatrixData(objectData);
    showDetailPanel = true;
  }
  
  // Function to close the detail panel
  function closeDetailPanel(object) {
    console.log(object)
    const sDC = (globalThis as any).viewer?.dataSources.getByName("spaceaware")[0];
    const entity = sDC?.entities.getById(object.objectID);
    entity.point.color = Color.RED;
    showDetailPanel = false;
    selectedObject = null;
  }
  
  // Function to get cell class for the matrix
  function getCellClass(rowIndex, colIndex) {
    if (!detailMatrixData) return "";
    
    const matrixIndex = rowIndex * detailMatrixData.colIndicators.length + colIndex;
    if (matrixIndex < detailMatrixData.matrix.length) {
      return detailMatrixData.matrix[matrixIndex] ? "bg-red-600" : "bg-green-600";
    }
    return "";
  }
  
  // Function to get cell value for the matrix
  function getCellValue(rowIndex, colIndex) {
    if (!detailMatrixData) return "";
    
    const matrixIndex = rowIndex * detailMatrixData.colIndicators.length + colIndex;
    if (matrixIndex < detailMatrixData.matrix.length) {
      return detailMatrixData.matrix[matrixIndex] ? "Alert" : "Normal";
    }
    return "";
  }
  
  // Function to set the clock to a specific time
  function setClockToTime(timeString) {
    if (!timeString) return;
    
    const time = JulianDate.fromDate(new Date(timeString));
    (globalThis as any).viewer!.clock.currentTime = time;
  }
  
  // Function to initialize the AG Grid
  function initializeGrid() {
    if (!gridDiv) {
      console.error("Grid div not found");
      return;
    }
    
    // Create new grid instance
    const gridOptions = {
      columnDefs: objectsOfInterestColumns,
      rowData: $objectsOfInterestData,
      defaultColDef: {
        resizable: true,
      },
      onGridReady: (params) => {
        gridApi.set(params.api);
        
        // Add row click event handler
        params.api.addEventListener('rowClicked', (event) => {
          const objectID = event.data.objectID;
          
          // Find entity in the viewer
          const sDC = (globalThis as any).viewer?.dataSources.getByName("spaceaware")[0];
          const entity = sDC?.entities.getById(objectID);
          
          if (entity) {
            // Focus camera on the entity
            // $trackedEntity = entity;
            highlightObject(objectID);
            
            // Show detailed view for the clicked object
            showObjectDetails(event.data);
            
            // Start animation if needed
            scenario.settings.ClockSettings.shouldAnimate.set(true);
          } else {
            console.warn("Entity not found:", objectID);
          }
        });
      }
    };
    
    // Create new grid
    new Grid(gridDiv, gridOptions);
    
    // Show the datatable
    datatableShow.set(true);
  }
  
  // Function to highlight all objects of interest in the 3D viewer
  function highlightAllObjectsOfInterest() {
    const viewer = (globalThis as any).viewer;
    if (!viewer) {
      console.error("Viewer not found");
      return;
    }
    
    const sDC = viewer.dataSources.getByName("spaceaware")[0];
    if (!sDC) {
      console.error("Space data source not found");
      return;
    }
    
    // Get all object IDs from our objects of interest
    const objectIDs = $objectsOfInterestData.map(obj => obj.objectID);
    
    // Store original properties and set new ones
    sDC.entities.suspendEvents();
  
    for (const entity of sDC.entities.values) {
      // Save original entity properties before modifying
      const originalProperties = {
        show: entity.show,
        color: entity.point?.color,
        pixelSize: entity.point?.pixelSize,
        labelShow: entity.label?.show,
        labelText: entity.label?.text?._value,
      };
      
      // Store the original properties for later restoration
      originalEntityProperties.set(entity.id, originalProperties);
      
      // If this entity is in our objects of interest list
      if (objectIDs.includes(entity.id.toString())) {
        // Make it visible
        entity.show = true;
        
        // Set point properties
        if (entity.point) {
          entity.point.color = Color.RED;
          entity.point.pixelSize = 8; // Make it larger
        }
        
        // Ensure label is visible and shows the common name
        if (entity.label) {
          entity.label.show = true;
          
          // Find the common name from our data
          const objectData = $objectsOfInterestData.find(obj => obj.objectID === entity.id.toString());
          if (objectData) {
            entity.label.text = objectData.commonName;
          }
        }
      } 
    }
    
    sDC.entities.resumeEvents();
    console.log("Objects highlighted in viewer");
  }
  
  // Function to restore original properties of entities
  function restoreEntityProperties() {
    const viewer = (globalThis as any).viewer;
    if (!viewer) return;
    
    const sDC = viewer?.dataSources.getByName("spaceaware")[0];
    if (!sDC) return;
    
    sDC.entities.suspendEvents();

    sDC?.entities.values.forEach((e: any) => {
      const originalProperties = originalEntityProperties.get(e.id);
      if (originalProperties) {
        e.show = true;
        if (e.point) {
          e.point.color = Color.WHITE;
          e.point.pixelSize = 1;
        }
        if (e.label) {
          e.label.show = false;
        }
      }
    });
    sDC.entities.resumeEvents();
    viewer.scene.render;
    originalEntityProperties.clear(); // Clear the map on destruction
  };
  
  onMount(async () => {
    console.log("OOI Modal mounted");
    _shouldAnimate = (globalThis as any).viewer?.clock.shouldAnimate || true;
    scenario.settings.ClockSettings.shouldAnimate.set(true);
    scenario.settings.ClockSettings.multiplier.set(30);
    
    // First make sure we have data set
    console.log("Current data in store:", $objectsOfInterestData.length, "objects");
    
    // Make sure last updated is initialized
    if (!$lastUpdated) {
      lastUpdated.set(new Date());
    }
    
    // Prepare the data table - Force these to happen in order
    columnDefs.set(objectsOfInterestColumns);
    console.log("Columns set:", objectsOfInterestColumns.length);
    
    // If we don't have data yet, use sample data
    if ($objectsOfInterestData.length === 0) {
      objectsOfInterestData.set(sampleData);
    }
    
    // Set data
    data.set($objectsOfInterestData);
    console.log("Data set:", $objectsOfInterestData.length, "items");
    
    // Sort objects by priority
    sortObjectsByPriority();
    console.log("Data sorted");
    
    // Initialize the grid
    setTimeout(() => {
      initializeGrid();
    }, 100); // Small delay
    
    // Highlight objects in the viewer
    highlightAllObjectsOfInterest();
    
    // Try to fetch fresh data
    try {
      console.log("Attempting to fetch fresh data");
      await fetchObjectsOfInterest();
      sortObjectsByPriority();
      
      // Force update the data
      data.set([...$objectsOfInterestData]);
      console.log("Fresh data set:", $objectsOfInterestData.length, "items");
      
      // Force refresh grid
      if ($gridApi) {
        $gridApi.setRowData($objectsOfInterestData);
        console.log("Grid data updated via API");
      } else {
        console.warn("Grid API not available");
      }
      
      // Update highlighted objects with new data
      highlightAllObjectsOfInterest();
      console.log('Refreshed objects highlighted.')
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  });
  
  onDestroy(() => {
    console.log("OOI Modal destroyed");
    
    // Restore original entity properties
    restoreEntityProperties();
    
    // Clean up
    datatableShow.set(false);
    scenario.settings.ClockSettings.shouldAnimate.set(_shouldAnimate);
    
    // Clean up grid API reference
    gridApi.set(null);
  });
  
  // Force update when data changes
  $: {
    if ($objectsOfInterestData && $gridApi) {
      console.log("Reactive data update:", $objectsOfInterestData.length, "items");
      $gridApi.setRowData($objectsOfInterestData);
    }
  }

  const closeModal = () => {
    $content = $lastcontent || undefined;
    $lastcontent = undefined;
    datatableShow.set(false);
    scenario.settings.ClockSettings.shouldAnimate.set(_shouldAnimate);
  };
  
  // Refresh data from the server
  async function refreshData() {
    console.log("Refresh requested");
    try {
      isLoading.set(true);
      await fetchObjectsOfInterest();
      sortObjectsByPriority();
      
      // Force update with a new array
      data.set([...$objectsOfInterestData]);
      
      if ($gridApi) {
        $gridApi.setRowData($objectsOfInterestData);
      }
      
      // Update highlighted objects with new data
      highlightAllObjectsOfInterest();
      isLoading.set(false);
    } catch (error) {
      console.error("Failed to refresh data", error);
      isLoading.set(false);
    }
  }
  
  // Format the last updated time
  function formatLastUpdated(date: Date | null): string {
    if (!date) return "Never";
    
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) { // Less than a minute
      return "Just now";
    }
    
    if (diff < 3600000) { // Less than an hour
      const minutes = Math.floor(diff / 60000);
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    }
    
    if (diff < 86400000) { // Less than a day
      const hours = Math.floor(diff / 3600000);
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    }
    
    // Format as date
    return date.toLocaleString();
  }
</script>

<!-- Bottom panel modal -->
<div class="fixed bottom-0 left-0 right-0 pointer-events-auto select-none z-50">
  <div class="w-full bg-gray-800 bg-opacity-85 border-t border-gray-600 shadow-xl">
    <!-- Header bar -->
    <div class="flex justify-between items-center px-4 py-2 border-b border-gray-600">
      <div class="flex items-center">
        <p class="text-white font-[300] text-xl">Objects of Interest</p>
        <button 
          class="ml-4 bg-blue-600 hover:bg-blue-700 text-xs rounded px-2 py-1 text-white flex items-center"
          on:click={refreshData}
          disabled={$isLoading}>
          {#if $isLoading}
            <span class="animate-spin mr-1">⟳</span> Loading...
          {:else}
            <span class="mr-1">⟳</span> Refresh
          {/if}
        </button>
        <div class="ml-4 text-xs text-gray-300">
          Total: {$objectsOfInterestData.length} objects
        </div>
        {#if $lastUpdated}
          <div class="ml-4 text-xs text-gray-400">
            Last updated: {formatLastUpdated($lastUpdated)}
          </div>
        {/if}
      </div>
      <CloseButton onclick={closeModal} />
    </div>
    
    <!-- Flex container for main table and detail panel -->
    <div class="flex flex-row w-full" style="height: 300px; max-height: 25vh;">
      <!-- Table container - adjust width based on detail panel visibility -->
      <div class="ag-theme-balham-dark" style="{showDetailPanel ? 'width: 60%;' : 'width: 100%;'}">
        <!-- This div needs to have the ag-theme class for the DataTable to work properly -->
        <div bind:this={gridDiv} id="ooiDataTable" class="w-full h-full">
          {#if !$datatableShow}
            <div class="flex items-center justify-center h-full">
              <p class="text-gray-400">Loading data table...</p>
            </div>
          {/if}
        </div>
      </div>
      
      <!-- Detail panel - shown when an object is selected -->
      {#if showDetailPanel && selectedObject}
        <div class="bg-gray-800 border-l border-gray-600 overflow-y-auto h-full" style="width: 100%;">
          <div class="p-2 relative">
            <!-- Close button for detail panel -->
            <button 
              class="absolute top-2 right-2 text-gray-400 hover:text-white text-xl font-bold"
              on:click={closeDetailPanel(selectedObject)}>
              ×
            </button>
            
            <!-- Object details -->
            <div class="text-left flex flex-row flex-wrap gap-3 mb-4 w-full font-mono text-sm">
              <div class="px-2 py-1 bg-gray-700 rounded">
                <span class="font-semibold">NAME:</span> {selectedObject.commonName}
              </div>
              <div class="px-2 py-1 bg-gray-700 rounded cursor-pointer" on:click={() => { $trackedEntity = selectedObject; }}>
                <span class="font-semibold">ID:</span> {selectedObject.objectID}
              </div>
              <div class="px-2 py-1 bg-gray-700 rounded">
                <span class="font-semibold">PRIORITY:</span> {selectedObject.priority}
              </div>
              <div class="px-2 py-1 bg-gray-700 rounded">
                <span class="font-semibold">COUNTRY:</span> {selectedObject.country}
              </div>
              <div class="px-2 py-1 bg-gray-700 rounded">
                <span class="font-semibold">TYPE:</span> {selectedObject.catalogType}
              </div>
            </div>
                        
            <!-- Matrix display -->
            {#key detailMatrixData}
              {#if detailMatrixData?.colIndicators?.length}
                <div class="overflow-auto p-2 w-full">
                  <table class="w-full border-collapse">
                    <tr>
                      <th></th>
                      {#each detailMatrixData.colIndicators as colIndicator}
                        <th class="border px-2 whitespace-nowrap w-6 h-6">{colIndicator}</th>
                      {/each}
                    </tr>
                    {#if detailMatrixData.rowIndicators}
                      {#each detailMatrixData.rowIndicators as rowIndicator, rowIndex}
                        <tr>
                          <th class="border px-2 w-6 h-6">{rowIndicator}</th>
                          {#each detailMatrixData.colIndicators as _, colIndex}
                            <td
                              class="border text-center font-bold w-6 h-6 {getCellClass(rowIndex, colIndex)}"
                            >{getCellValue(rowIndex, colIndex)}</td>
                          {/each}
                        </tr>
                      {/each}
                    {/if}
                  </table>
                </div>
              {/if}
            {/key}
            
            <!-- Additional info section -->
            <div class="mt-4 text-xs">
              <h4 class="font-bold mb-2">Additional Information</h4>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="font-semibold">Nomination Time:</span> 
                  {selectedObject.eventStartTime || 'N/A'}
                </div>
                <div>
                  <span class="font-semibold">Status:</span> 
                  <span class={selectedObject.priority <= 6 ? 'text-red-400' : 'text-green-400'}>
                    {'Class Violator'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* Ensure AG Grid styling is properly applied */
  :global(.ag-theme-balham-dark) {
    --ag-background-color: rgba(48, 51, 54, 0.95);
    --ag-odd-row-background-color: rgba(60, 63, 66, 0.5);
  }
  
  /* Fix for the close button */
  :global(.ag-root-wrapper) {
    border: none !important;
  }
  
  /* Disable button styling */
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  /* Matrix display styles */
  .bg-red-600 {
    background-color: rgb(220, 38, 38);
    color: white;
  }
  
  .bg-green-600 {
    background-color: rgb(22, 163, 74);
    color: white;
  }
</style>