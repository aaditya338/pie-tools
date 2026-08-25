local M = {}

function M.log(msg)
    print("[PieTools] " .. tostring(msg))
end

function M.warn(msg)
    print("[PieTools WARNING] " .. tostring(msg))
end

function M.error(msg)
    print("[PieTools ERROR] " .. tostring(msg))
end

return M
