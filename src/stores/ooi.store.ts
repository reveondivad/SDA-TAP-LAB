// stores/ooi.store.ts
import { writable, get } from 'svelte/store';

export const nodeREDURL = "node-red.katalystspace.com";

// Define interface for object of interest
export interface ObjectOfInterest {
  objectID: string;
  commonName: string;
  country: string;
  catalogType: string;
  priority: string;
  highlighted?: boolean;
}

// Create the stores
export const objectsOfInterestData = writable<ObjectOfInterest[]>([]);
export const isLoading = writable<boolean>(false);
export const lastUpdated = writable<Date | null>(null);

// Sample data for testing and fallback
export const sampleData: ObjectOfInterest[] = [
  { objectID: "63604", commonName: "SHIYAN 27F", country: "CN", catalogType: "PAYLOAD", priority: "4" },
  { objectID: "55507", commonName: "BLOCK DM-SL R/B", country: "CIS", catalogType: "ROCKET BODY", priority: "3" },
  { objectID: "44637", commonName: "TJS-4", country: "CN", catalogType: "PAYLOAD", priority: "5" },
  { objectID: "55131", commonName: "SJ-23", country: "CN", catalogType: "PAYLOAD", priority: "3" },
  { objectID: "55842", commonName: "BREEZE-M R/B", country: "CIS", catalogType: "ROCKET BODY", priority: "4" },
  { objectID: "55180", commonName: "SJ-23 AKM", country: "CN", catalogType: "ROCKET BODY", priority: "4" },
  { objectID: "50001", commonName: "EXPRESS AMU-7", country: "CIS", catalogType: "PAYLOAD", priority: "3" },
  { objectID: "43432", commonName: "COSMOS 2526", country: "CIS", catalogType: "PAYLOAD", priority: "4" },
];

// Initialize with sample data immediately
objectsOfInterestData.set(sampleData);
lastUpdated.set(new Date());
console.log("OOI Store initialized with sample data");

// Function to fetch objects of interest from Node-RED
export const fetchObjectsOfInterest = async () => {
  // Set loading state
  isLoading.set(true);
  console.log("Fetching objects of interest from API");
  
  try {
    const apiUrl = `https://${nodeREDURL}/api/nominations`;
    console.log("Fetch URL:", apiUrl);
    
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("API response received:", data.length, "items");
    
    // Transform the data to match our interface if needed
    const formattedData: ObjectOfInterest[] = data.map(obj => ({
      eventStartTime: obj.EVENT_START_TIME,
      objectID: obj.objectID || obj.id || obj.ID,
      commonName: obj.OBJECT_NAME || obj.name || obj.NAME,
      country: obj.COUNTRY_CODE || obj.country || obj.COUNTRY,
      catalogType: obj.OBJECT_TYPE || obj.type || obj.CATEGORY || 'UNKNOWN',
      priority: obj.PRIORITY || '4',
      col_indicators: obj.COL_INDICATORS || [],
      row_indicators: obj.ROW_INDICATORS || [],
      matrix: obj.MATRIX || [],
    }));
    
    // Update the store with the new data
    objectsOfInterestData.set(formattedData);
    lastUpdated.set(new Date());
    console.log("Updated objects of interest from API:", formattedData.length, "objects");
    return formattedData;
  } catch (error) {
    console.error("Error fetching objects of interest:", error);
    // Keep using the existing data (which should be at least the sample data)
    return get(objectsOfInterestData);
  } finally {
    // Clear loading state
    isLoading.set(false);
  }
};

// Alternative function that attempts to use data from the viewer first
export const fetchObjectsFromViewer = () => {
  isLoading.set(true);
  console.log("Fetching objects from viewer");
  
  try {
    // Get the data source
    const dataSource = (globalThis as any).viewer?.dataSources.getByName("spaceaware")[0];
    if (!dataSource) {
      throw new Error("Space data source not found");
    }
    
    // Get object IDs of interest - this would come from your API or configuration
    // For testing, we'll just use the IDs from the sample data
    const objectIDsOfInterest = sampleData.map(obj => obj.objectID);
    
    // Filter entities from the viewer
    const entitiesOfInterest = dataSource.entities.values.filter(entity => 
      objectIDsOfInterest.includes(entity.id)
    );
    
    // Transform to our format
    const formattedData: ObjectOfInterest[] = entitiesOfInterest.map(entity => {
      const properties = entity.properties;
      const OMM = properties.OMM?.getValue() || {};
      const CAT = properties.CAT?.getValue() || {};
      
      return {
        objectID: entity.id,
        commonName: CAT.OBJECT_NAME || OMM.OBJECT_NAME || entity.name || "Unknown",
        country: CAT.COUNTRY_CODE || "Unknown",
        catalogType: CAT.OBJECT_TYPE || "UNKNOWN",
        priority: "4"  // Default priority, would need to come from your configuration
      };
    });
    
    objectsOfInterestData.set(formattedData);
    lastUpdated.set(new Date());
    console.log("Data fetched from viewer:", formattedData.length, "items");
    return formattedData;
  } catch (error) {
    console.error("Error fetching objects from viewer:", error);
    // Fall back to sample data
    return sampleData;
  } finally {
    isLoading.set(false);
  }
};

// Initialize the store
export function initializeStore() {
  console.log("Initializing Objects of Interest store with sample data");
  
  // Always start with sample data to ensure we have something to display
  objectsOfInterestData.set(sampleData);
  lastUpdated.set(new Date());
  sortObjectsByPriority();
  
  // Try to fetch data from API, but don't stress if it fails
  setTimeout(() => {
    fetchObjectsOfInterest().catch(err => {
      console.log("Error fetching from API, continuing with sample data");
    });
  }, 2000);
  
  return {
    refresh: async () => {
      // Always resort the data we have
      sortObjectsByPriority();
      
      // Try to fetch fresh data, but don't stress if it fails
      return fetchObjectsOfInterest().catch(err => {
        console.log("Failed to refresh data, using existing data");
        return get(objectsOfInterestData);
      });
    }
  };
}

// Sort objects by priority
export const sortObjectsByPriority = () => {
  objectsOfInterestData.update(objects => {
    const sorted = [...objects].sort((a, b) => {
      // Sort by priority (lower number = higher priority)
      const priorityA = parseInt(a.priority) || 9;
      const priorityB = parseInt(b.priority) || 9;
      
      return priorityA - priorityB || 
            // Then sort alphabetically by name if priorities are equal
            a.commonName.localeCompare(b.commonName);
    });
    console.log("Objects sorted by priority");
    return sorted;
  });
};

// Update a specific object
export const updateObject = (objectID: string, updates: Partial<ObjectOfInterest>) => {
  objectsOfInterestData.update(objects => {
    return objects.map(obj => {
      if (obj.objectID === objectID) {
        return { ...obj, ...updates };
      }
      return obj;
    });
  });
};

// Highlight an object
export const highlightObject = (objectID: string, highlight: boolean = true,) => {
  updateObject(objectID, { highlighted: highlight });
  console.log(`Object ${objectID} highlight set to ${highlight}`);
  
  // Clear highlight after 3 seconds
  if (highlight) {
    setTimeout(() => {
      updateObject(objectID, { highlighted: false });
      console.log(`Object ${objectID} highlight cleared`);
    }, 3000);
  }
};

