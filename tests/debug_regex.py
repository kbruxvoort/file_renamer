import re

def test_regex():
    filenames = [
        "Pokemon - 2x01 - Pallet Party Panic",
        "Pokemon.2x01.Title",
        "Pokemon 2x01 Title"
    ]
    
    # Current Regex
    # r'(.+?)[ .-](\d{1,2})[xX](\d{1,2})(?:[ .-]*(.+?))?$'
    pattern = re.compile(r'(.+?)[ .-](\d{1,2})[xX](\d{1,2})(?:[ .-]*(.+?))?$')
    
    print("--- Current Regex ---")
    for fname in filenames:
        match = pattern.search(fname)
        if match:
             print(f"MATCH: '{fname}' -> Title: '{match.group(1)}'")
        else:
             print(f"FAIL:  '{fname}'")

    # Proposed Regex
    # Relax the separator to allow optional spaces/dashes
    # r'(.+?)(?:[ .-]+|\s+-\s+)(\d{1,2})[xX](\d{1,2})(?:[ .-]*(.+?))?$'
    pattern_new = re.compile(r'(.+?)(?:[ .-]+|\s+-\s+)(\d{1,2})[xX](\d{1,2})(?:[ .-]*(.+?))?$')

    print("\n--- New Regex ---")
    for fname in filenames:
        match = pattern_new.search(fname)
        if match:
             print(f"MATCH: '{fname}' -> Title: '{match.group(1)}' S:{match.group(2)} E:{match.group(3)}")
        else:
             print(f"FAIL:  '{fname}'")

if __name__ == "__main__":
    test_regex()
