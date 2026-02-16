import yaml from 'js-yaml';

export const stripManagedFields = (yamlString: string): string => {
    try {
        const doc = yaml.load(yamlString) as any;
        if (doc && doc.metadata) {
            delete doc.metadata.managedFields;
            // Also cleaning up null status if it exists and is empty/null, though usually we keep status
            // delete doc.status; 
        }
        return yaml.dump(doc, {
            indent: 2,
            lineWidth: -1, // Don't wrap long lines
            noRefs: true,  // Don't use aliases
            sortKeys: true // Consistent ordering
        });
    } catch (e) {
        console.error("Failed to strip managed fields", e);
        return yamlString;
    }
};
