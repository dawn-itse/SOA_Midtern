import { Input } from './ui/input';
import { Button } from './ui/button';
import { Search } from 'lucide-react';
import { useState } from 'react';

const SearchSection = ({ onSearch }) => {
    const [mssv, setMssv] = useState('');

    const handleSearch = () => {
        onSearch(mssv);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handleSearch();
    };

    return (
        <div className="flex gap-2 w-full max-w-2xs">
            <Input
                className="p-2.5 border rounded-2xl"
                value={mssv}
                onChange={(e) => setMssv(e.target.value)}
                onKeyDown={handleKeyDown}
                type="text"
                placeholder="Nhập MSSV để tra cứu"
            />
            <Button onClick={handleSearch}
                ><Search/>
            </Button>
        </div>
    );
};

export default SearchSection;
